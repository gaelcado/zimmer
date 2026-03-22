import { useEffect, useMemo, useState, useCallback, useLayoutEffect, useRef } from 'react'

export default function LogsScene() {
  const [logs, setLogs] = useState([])
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [meta, setMeta] = useState(null)
  const [tail, setTail] = useState(800)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const preRef = useRef(null)
  const reqSeqRef = useRef(0)
  const pendingScrollRef = useRef(null)

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs')
      const data = await res.json()
      setLogs(Array.isArray(data) ? data : [])
      if (Array.isArray(data) && data.length > 0) {
        setSelected(prev => (data.some(l => l.name === prev) ? prev : data[0].name))
      } else {
        setSelected(null)
        setContent('')
        setMeta(null)
      }
    } catch {
      setLogs([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadFile = useCallback(async () => {
    if (!selected) return
    const reqId = ++reqSeqRef.current
    setLoadingFile(true)
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(selected)}?tail=${tail}`)
      const data = await res.json()
      if (reqId !== reqSeqRef.current) return
      if (data.error) {
        setContent(prev => prev || `[error] ${data.error}`)
        setMeta(null)
      } else {
        const next = data.content ?? ''
        setContent(prev => {
          if (prev === next) return prev
          pendingScrollRef.current = snapshotScroll(preRef.current)
          return next
        })
        setMeta(data)
      }
    } catch (e) {
      if (reqId !== reqSeqRef.current) return
      setContent(prev => prev || `[error] ${String(e)}`)
      setMeta(null)
    } finally {
      if (reqId === reqSeqRef.current) setLoadingFile(false)
    }
  }, [selected, tail])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    loadFile()
  }, [loadFile])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      if (document.hidden) return
      loadLogs()
      if (selected) loadFile()
    }, 3000)
    return () => clearInterval(id)
  }, [autoRefresh, loadLogs, loadFile, selected])

  useLayoutEffect(() => {
    const el = preRef.current
    const snap = pendingScrollRef.current
    if (!el || !snap) return
    if (snap.atBottom) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - snap.distanceFromBottom)
    }
    pendingScrollRef.current = null
  }, [content])

  const summary = useMemo(() => {
    if (!meta) return ''
    if (typeof meta.line_count === 'number') {
      return `${meta.shown_lines}/${meta.line_count} lines${meta.truncated ? ' (tail)' : ''}`
    }
    return `${meta.shown_lines} lines${meta.truncated ? ' (tail)' : ''}`
  }, [meta])

  return (
    <div className="h-full flex" style={{ background: 'var(--bg)' }}>
      <aside className="w-72 flex-none border-r flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="h-10 px-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>Logs</span>
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{logs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="px-3 py-4 text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading...</div>
          ) : logs.length === 0 ? (
            <div className="px-3 py-4 text-[12px]" style={{ color: 'var(--text-dim)' }}>No log files found</div>
          ) : (
            logs.map(log => {
              const active = log.name === selected
              return (
                <button
                  key={log.name}
                  onClick={() => setSelected(log.name)}
                  className="w-full text-left px-3 py-2 border-b"
                  style={{
                    borderColor: 'var(--border)',
                    background: active ? 'color-mix(in oklab, var(--accent) 12%, var(--panel) 88%)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                  }}
                >
                  <div className="text-[12px] font-medium truncate">{log.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{fmtBytes(log.size)}</div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="h-10 px-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <div className="min-w-0">
            <div className="text-[12px] font-medium truncate" style={{ color: 'var(--text)' }}>{selected || 'No file selected'}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {summary}{loadingFile ? ' · refreshing…' : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="text-[11px] px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value={200}>200 lines</option>
              <option value={800}>800 lines</option>
              <option value={2000}>2000 lines</option>
            </select>
            <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              auto
            </label>
            <button
              onClick={() => { loadLogs(); loadFile() }}
              className="px-2.5 py-1 text-[11px] rounded border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
            >
              refresh
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <pre
            ref={preRef}
            className="h-full overflow-auto p-3 m-0 text-[12px] leading-relaxed"
            style={{
              background: 'var(--bg)',
              color: 'var(--text-muted)',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            {content || 'No content'}
          </pre>
        </div>
      </section>
    </div>
  )
}

function fmtBytes(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function snapshotScroll(el) {
  if (!el) return null
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  return {
    atBottom: distanceFromBottom < 20,
    distanceFromBottom,
  }
}
