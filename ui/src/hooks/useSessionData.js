import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSSE } from './useSSE.js'

/**
 * Unified state: REST polling + SSE live events.
 *
 * Returns:
 *   sessions     — array from /api/sessions (DB-backed)
 *   activeTasks  — Map<call_id, {tool, started_at, args, session_id}> (live, SSE-driven)
 *   llmActive    — Set<session_id> — sessions currently waiting for LLM response
 *   stats        — object from /api/stats
 *   connected    — boolean SSE connection state
 *   lastToolEnd  — {call_id, ts} updated whenever a tool_end event fires
 *   fetchTools   — async fn(sessionId) → tool call array
 *   killSession  — async fn(sessionId) → bool
 */
export function useSessionData() {
  const [sessions, setSessions]       = useState([])
  const [stats, setStats]             = useState({})
  const [processes, setProcesses]     = useState([])
  const [activeTasks, setActiveTasks] = useState(new Map())
  const [llmActiveHooks, setLlmActiveHooks] = useState(new Set())
  const [llmActiveInferred, setLlmActiveInferred] = useState(new Set())
  const [connected, setConnected]     = useState(false)
  const [gatewayHealthy, setGatewayHealthy] = useState(false)
  const [lastToolEnd, setLastToolEnd] = useState(null)
  const [honchoStatus, setHonchoStatus] = useState(null)
  // Map<session_id, {tool, reason}> — sessions with an outstanding permission request
  const [pendingPermissions, setPendingPermissions] = useState(new Map())
  // Map<session_id, number> — queue depth per session
  const [queueDepths, setQueueDepths] = useState(new Map())
  const connectedRef = useRef(false)

  const fetchJson = useCallback(async (url, { timeoutMs = 6000, retries = 1 } = {}) => {
    let lastErr = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: ac.signal })
        if (res.ok) return await res.json()
      } catch (e) {
        lastErr = e
      } finally {
        clearTimeout(timer)
      }
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
    if (lastErr?.name !== 'AbortError') {
      // Keep failures silent in hook callers; return null indicates unavailable.
    }
    return null
  }, [])

  // ── REST loaders ─────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const data = await fetchJson('/api/sessions', { timeoutMs: 7000, retries: 1 })
    if (Array.isArray(data)) setSessions(data)
  }, [fetchJson])

  const loadStats = useCallback(async () => {
    const data = await fetchJson('/api/stats', { timeoutMs: 5000, retries: 1 })
    if (data && typeof data === 'object') setStats(data)
  }, [fetchJson])

  const loadProcesses = useCallback(async () => {
    const rows = await fetchJson('/api/processes', { timeoutMs: 5000, retries: 0 })
    if (Array.isArray(rows)) {
      setProcesses(rows)
    }
  }, [fetchJson])

  const loadHonchoStatus = useCallback(async () => {
    const data = await fetchJson('/api/honcho/status', { timeoutMs: 5000, retries: 0 })
    if (data && typeof data === 'object') setHonchoStatus(data)
  }, [fetchJson])

  const loadHealth = useCallback(async () => {
    const data = await fetchJson('/api/health', { timeoutMs: 3500, retries: 0 })
    setGatewayHealthy(Boolean(data && data.ok))
  }, [fetchJson])

  const replayActiveTools = useCallback(async () => {
    try {
      const activeMap = await fetchJson('/api/events/active-tools', { timeoutMs: 6000, retries: 0 })
      if (!activeMap || typeof activeMap !== 'object') return
      const map = new Map()
      for (const [callId, ev] of Object.entries(activeMap)) {
        map.set(callId, {
          tool: ev.tool,
          started_at: ev.ts,
          args: ev.args,
          session_id: ev.session_id || ev.task_id || '',
          call_id: callId,
        })
      }
      setActiveTasks(map)
    } catch (_) {}
  }, [fetchJson])

  const replayActiveLlm = useCallback(async () => {
    try {
      const data = await fetchJson('/api/events/active-llm?window_sec=180', { timeoutMs: 6000, retries: 0 })
      if (!data || typeof data !== 'object') return
      const rows = Array.isArray(data?.sessions) ? data.sessions : []
      setLlmActiveInferred(new Set(rows))
    } catch (_) {}
  }, [fetchJson])

  // Initial load on mount.
  useEffect(() => {
    loadSessions()
    loadStats()
    loadProcesses()
    replayActiveTools()
    replayActiveLlm()
    loadHonchoStatus()
    loadHealth()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Polling: 5s when SSE is disconnected, 30s when connected (safety net only).
  // Re-creates the interval whenever `connected` flips so the rate is correct.
  useEffect(() => {
    const interval = setInterval(() => {
      loadSessions()
      loadStats()
      loadProcesses()
      loadHealth()
    }, connected ? 30000 : 5000)
    return () => clearInterval(interval)
  }, [connected, loadSessions, loadStats, loadProcesses, loadHealth])

  // Fallback reconciliation for active tools — only poll when SSE is down.
  // When SSE is live the tool_start/tool_end events keep activeTasks accurate.
  useEffect(() => {
    if (connected) return
    const interval = setInterval(() => {
      replayActiveTools()
      replayActiveLlm()
    }, 4000)
    return () => clearInterval(interval)
  }, [connected, replayActiveTools, replayActiveLlm])

  // ── SSE event handler ──────────────────────────────────────────────────────

  const handleEvent = useCallback((event) => {
    if (!connectedRef.current) {
      connectedRef.current = true
      setConnected(true)
      setGatewayHealthy(true)
    }

    if (event.type === 'tool_start') {
      const key = event.call_id
      if (!key) return
      setActiveTasks(prev => {
        const next = new Map(prev)
        next.set(key, {
          tool:       event.tool,
          started_at: event.ts,
          args:       event.args,
          session_id: event.session_id || '',
          call_id:    key,
        })
        return next
      })
    } else if (event.type === 'tool_end') {
      const key = event.call_id
      if (!key) return
      setActiveTasks(prev => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
      setLastToolEnd({ call_id: key, ts: event.ts })
      // Refresh sessions after tool completes
      setTimeout(loadSessions, 400)
      setTimeout(loadStats, 500)

    } else if (event.type === 'llm_start') {
      const sid = event.session_id
      if (sid) setLlmActiveHooks(prev => new Set(prev).add(sid))

    } else if (event.type === 'llm_end') {
      const sid = event.session_id
      if (sid) setLlmActiveHooks(prev => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })

    } else if (event.type === 'session_start') {
      // Immediately refresh sessions list
      setTimeout(loadSessions, 200)
      setTimeout(loadStats, 300)

    } else if (event.type === 'task_queued') {
      // queue depth increases by 1 when a task is queued
      const sid = event.session_id
      if (sid) setQueueDepths(prev => {
        const next = new Map(prev)
        next.set(sid, (next.get(sid) ?? 0) + 1)
        return next
      })

    } else if (event.type === 'queue_change') {
      const sid = event.session_id
      if (sid) setQueueDepths(prev => {
        const next = new Map(prev)
        const depth = event.queue_depth ?? 0
        if (depth <= 0) next.delete(sid)
        else next.set(sid, depth)
        return next
      })

    } else if (event.type === 'permission_request') {
      const sid = event.session_id
      if (sid) setPendingPermissions(prev => {
        const next = new Map(prev)
        next.set(sid, { tool: event.tool, reason: event.reason })
        return next
      })

    } else if (event.type === 'permission_resolved') {
      const sid = event.session_id
      if (sid) setPendingPermissions(prev => {
        const next = new Map(prev)
        next.delete(sid)
        return next
      })

    } else if (event.type === 'session_end') {
      const sid = event.session_id
      // Clean up any active tasks for this session
      setActiveTasks(prev => {
        const next = new Map(prev)
        for (const [k, v] of next) {
          if (v.session_id === sid) next.delete(k)
        }
        return next
      })
      setLlmActiveHooks(prev => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
      setLlmActiveInferred(prev => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
      setPendingPermissions(prev => {
        const next = new Map(prev)
        next.delete(sid)
        return next
      })
      setQueueDepths(prev => {
        const next = new Map(prev)
        next.delete(sid)
        return next
      })
      setTimeout(loadSessions, 300)
      setTimeout(loadStats, 400)
    }
  }, [loadSessions, loadStats])

  // SSE disconnect handler
  const handleConnect = useCallback(() => {
    connectedRef.current = true
    setConnected(true)
    setGatewayHealthy(true)
  }, [])

  // SSE disconnect handler
  const handleDisconnect = useCallback(() => {
    connectedRef.current = false
    setConnected(false)
  }, [])

  const llmActive = useMemo(() => {
    const merged = new Set(llmActiveInferred)
    for (const sid of llmActiveHooks) merged.add(sid)
    return merged
  }, [llmActiveHooks, llmActiveInferred])

  useSSE('/api/events', handleEvent, handleConnect, handleDisconnect)

  // ── Actions ────────────────────────────────────────────────────────────────

  const fetchTools = useCallback(async (sessionId) => {
    const rows = await fetchJson(`/api/sessions/${sessionId}/tools`, { timeoutMs: 8000, retries: 1 })
    if (Array.isArray(rows)) return rows
    return []
  }, [fetchJson])

  const killSession = useCallback(async (sessionId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/kill`, { method: 'POST' })
      if (res.ok) {
        const { ok } = await res.json()
        if (ok) setTimeout(loadSessions, 300)
        return ok
      }
    } catch (_) {}
    return false
  }, [loadSessions])

  const renameSession = useCallback(async (sessionId, title) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: data.title } : s))
        }
        return data
      }
    } catch (_) {}
    return { ok: false, error: 'network error' }
  }, [])

  return { sessions, activeTasks, llmActive, stats, processes, connected, gatewayHealthy, lastToolEnd, honchoStatus, pendingPermissions, queueDepths, fetchTools, killSession, renameSession }
}
