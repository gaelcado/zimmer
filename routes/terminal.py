"""WebSocket PTY terminal endpoint."""

import asyncio
import fcntl
import json
import os
import pty
import struct
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/api/terminal")
async def api_terminal(websocket: WebSocket):
    await websocket.accept()
    master_fd, slave_fd = pty.openpty()
    proc = await asyncio.create_subprocess_exec(
        os.environ.get("SHELL", "/bin/bash"),
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env={**os.environ, "TERM": "xterm-256color"},
        close_fds=True,
    )
    os.close(slave_fd)

    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    loop = asyncio.get_event_loop()
    read_event = asyncio.Event()

    def _on_readable():
        read_event.set()

    loop.add_reader(master_fd, _on_readable)

    async def pty_to_ws():
        try:
            while True:
                read_event.clear()
                try:
                    data = os.read(master_fd, 16384)
                    if not data:
                        break
                    await websocket.send_bytes(data)
                except BlockingIOError:
                    await read_event.wait()
                except OSError:
                    break
        except Exception:
            pass

    async def ws_to_pty():
        try:
            while True:
                msg = await websocket.receive()
                msg_type = msg.get("type")
                if msg_type == "websocket.disconnect":
                    break
                if msg_type == "websocket.receive":
                    raw = msg.get("bytes")
                    if raw:
                        os.write(master_fd, raw)
                    text = msg.get("text")
                    if text:
                        try:
                            d = json.loads(text)
                            if d.get("type") == "resize":
                                fcntl.ioctl(
                                    master_fd, termios.TIOCSWINSZ,
                                    struct.pack("HHHH", d["rows"], d["cols"], 0, 0),
                                )
                                continue
                        except (json.JSONDecodeError, ValueError):
                            pass
                        os.write(master_fd, text.encode("utf-8"))
        except (WebSocketDisconnect, Exception):
            pass

    task_read = asyncio.create_task(pty_to_ws())
    task_write = asyncio.create_task(ws_to_pty())
    try:
        await asyncio.wait([task_read, task_write], return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in [task_read, task_write]:
            t.cancel()
        try:
            loop.remove_reader(master_fd)
        except Exception:
            pass
        try:
            proc.kill()
            await proc.wait()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
