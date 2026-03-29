"""Tests for EventBus — thread safety, publish/subscribe, active tools, history."""

import asyncio
import threading
import time

import pytest

from zimmer.event_bus import EventBus


class TestEventBusBasics:
    def test_publish_adds_to_history(self, event_bus):
        event_bus.publish({"type": "tool_start", "tool": "terminal"})
        history = event_bus.get_history()
        assert len(history) == 1
        assert history[0]["type"] == "tool_start"
        assert history[0]["tool"] == "terminal"

    def test_publish_adds_id_and_ts(self, event_bus):
        event_bus.publish({"type": "test"})
        ev = event_bus.get_history()[0]
        assert "id" in ev
        assert "ts" in ev
        assert isinstance(ev["ts"], float)
        assert len(ev["id"]) == 36  # UUID format

    def test_publish_does_not_mutate_input(self, event_bus):
        original = {"type": "test", "data": "value"}
        event_bus.publish(original)
        assert "id" not in original
        assert "ts" not in original

    def test_history_respects_max_size(self):
        bus = EventBus(max_size=5)
        for i in range(10):
            bus.publish({"type": "test", "i": i})
        history = bus.get_history()
        assert len(history) == 5
        assert history[0]["i"] == 5  # oldest retained
        assert history[-1]["i"] == 9

    def test_history_returns_copy(self, event_bus):
        event_bus.publish({"type": "test"})
        h1 = event_bus.get_history()
        h2 = event_bus.get_history()
        assert h1 is not h2
        assert h1 == h2


class TestActiveTools:
    def test_tool_start_tracked(self, event_bus):
        event_bus.publish({"type": "tool_start", "call_id": "c1", "tool": "terminal"})
        active = event_bus.get_active_tools()
        assert "c1" in active
        assert active["c1"]["tool"] == "terminal"

    def test_tool_end_removes(self, event_bus):
        event_bus.publish({"type": "tool_start", "call_id": "c1", "tool": "terminal"})
        event_bus.publish({"type": "tool_end", "call_id": "c1"})
        active = event_bus.get_active_tools()
        assert "c1" not in active
        assert len(active) == 0

    def test_multiple_concurrent_tools(self, event_bus):
        event_bus.publish({"type": "tool_start", "call_id": "c1", "tool": "terminal"})
        event_bus.publish({"type": "tool_start", "call_id": "c2", "tool": "web_search"})
        active = event_bus.get_active_tools()
        assert len(active) == 2
        event_bus.publish({"type": "tool_end", "call_id": "c1"})
        active = event_bus.get_active_tools()
        assert len(active) == 1
        assert "c2" in active

    def test_tool_end_without_start_is_noop(self, event_bus):
        event_bus.publish({"type": "tool_end", "call_id": "nonexistent"})
        active = event_bus.get_active_tools()
        assert len(active) == 0

    def test_tool_start_without_call_id_ignored(self, event_bus):
        event_bus.publish({"type": "tool_start", "tool": "terminal"})
        active = event_bus.get_active_tools()
        assert len(active) == 0


class TestSubscription:
    @pytest.mark.asyncio
    async def test_subscribe_receives_events(self, event_bus):
        loop = asyncio.get_event_loop()
        event_bus.set_server_loop(loop)

        received = []

        async def consumer():
            async for ev in event_bus.subscribe():
                received.append(ev)
                if len(received) >= 2:
                    break

        # Publish from the same loop (simulating threadsafe call)
        task = asyncio.create_task(consumer())
        await asyncio.sleep(0.05)

        event_bus.publish({"type": "ev1"})
        event_bus.publish({"type": "ev2"})

        await asyncio.wait_for(task, timeout=2)
        assert len(received) == 2
        assert received[0]["type"] == "ev1"
        assert received[1]["type"] == "ev2"

    @pytest.mark.asyncio
    async def test_subscriber_cleanup_on_cancel(self, event_bus):
        loop = asyncio.get_event_loop()
        event_bus.set_server_loop(loop)

        async def consumer():
            async for _ in event_bus.subscribe():
                pass

        task = asyncio.create_task(consumer())
        await asyncio.sleep(0.05)

        assert len(event_bus._subscribers) == 1
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.05)
        assert len(event_bus._subscribers) == 0

    @pytest.mark.asyncio
    async def test_multiple_subscribers(self, event_bus):
        loop = asyncio.get_event_loop()
        event_bus.set_server_loop(loop)

        received_a = []
        received_b = []

        async def consumer_a():
            async for ev in event_bus.subscribe():
                received_a.append(ev)
                if len(received_a) >= 1:
                    break

        async def consumer_b():
            async for ev in event_bus.subscribe():
                received_b.append(ev)
                if len(received_b) >= 1:
                    break

        ta = asyncio.create_task(consumer_a())
        tb = asyncio.create_task(consumer_b())
        await asyncio.sleep(0.05)

        event_bus.publish({"type": "broadcast"})
        await asyncio.wait_for(asyncio.gather(ta, tb), timeout=2)

        assert len(received_a) == 1
        assert len(received_b) == 1

    def test_publish_without_loop_does_not_crash(self, event_bus):
        # No loop set — publish should still work (just adds to history)
        event_bus.publish({"type": "test"})
        assert len(event_bus.get_history()) == 1


class TestThreadSafety:
    def test_concurrent_publishes(self, event_bus):
        """Multiple threads publishing concurrently should not lose events."""
        n_threads = 8
        n_per_thread = 100
        barrier = threading.Barrier(n_threads)

        def worker(thread_id):
            barrier.wait()
            for i in range(n_per_thread):
                event_bus.publish({"type": "test", "tid": thread_id, "i": i})

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        history = event_bus.get_history()
        assert len(history) == n_threads * n_per_thread

    def test_concurrent_publish_and_read(self, event_bus):
        """Publishing and reading history concurrently should not deadlock."""
        stop = threading.Event()
        errors = []

        def publisher():
            for i in range(200):
                event_bus.publish({"type": "test", "i": i})

        def reader():
            while not stop.is_set():
                try:
                    event_bus.get_history()
                    event_bus.get_active_tools()
                except Exception as e:
                    errors.append(e)

        t1 = threading.Thread(target=publisher)
        t2 = threading.Thread(target=reader)
        t2.start()
        t1.start()
        t1.join(timeout=5)
        stop.set()
        t2.join(timeout=5)

        assert len(errors) == 0


class TestQueueFullBehavior:
    def test_queue_full_does_not_crash(self, event_bus_with_loop):
        """When a subscriber's queue is full, publish should skip it silently."""
        import time

        bus = event_bus_with_loop
        q = asyncio.Queue(maxsize=5)
        bus._subscribers.append(q)

        # Publish more than queue can hold
        for i in range(20):
            bus.publish({"type": "test", "i": i})

        time.sleep(0.1)  # let call_soon_threadsafe fire

        # History should have all 20
        assert len(bus.get_history()) == 20
        # Queue should have first 5 (rest silently dropped)
        assert q.qsize() == 5
