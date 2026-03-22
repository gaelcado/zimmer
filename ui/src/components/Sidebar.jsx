import { useState, useRef, useEffect, useMemo } from 'react'

const SOURCE_COLORS = {
  cli:      '#155838',
  telegram: '#38bdf8',
  discord:  '#818cf8',
  web:      '#fbbf24',
  cron:     '#2dd4bf',
  gateway:  '#71717a',
}

export default function Sidebar({ sessions, filteredSessions, filter, onFilterChange, selectedId, onSelect, llmActive, sessionActiveTasks, onRename }) {
  const sources = [...new Set(sessions.map(s => s.source).filter(Boolean))].sort()
  const activeCount = sessions.filter(s => !s.ended_at).length
  const lineageRows = useMemo(() => buildLineageRows(filteredSessions), [filteredSessions])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameApplying, setRenameApplying] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [renameItems, setRenameItems] = useState([])
  const [renameInstructions, setRenameInstructions] = useState('Keep titles concise and action-oriented.')

  const filters = [
    { key: 'active', label: 'Live',   count: activeCount, highlight: activeCount > 0 },
    { key: 'all',    label: 'All',    count: sessions.length },
    ...sources.map(src => ({
      key: src,
      label: src,
      count: sessions.filter(s => s.source === src).length,
      color: SOURCE_COLORS[src],
    })),
  ]

  return (
    <aside className="flex flex-col w-64 flex-none border-r overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
      <div className="flex-none px-2.5 pt-2.5 pb-2 border-b flex flex-wrap gap-1.5" style={{ borderColor: 'var(--border)' }}>
        {filters.map(f => {
          const isActive = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] uppercase tracking-wide transition-colors border"
              style={{
                borderColor: isActive ? 'var(--accent)' : 'transparent',
                background: isActive ? 'color-mix(in oklab, var(--accent) 14%, var(--bg-elev) 86%)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {f.color && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }} />
              )}
              {f.highlight && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
              )}
              {f.label}
              <span style={{ color: 'var(--text-dim)' }}>{f.count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {lineageRows.length === 0 ? (
          <div className="px-3 py-6 text-[13px] italic text-center" style={{ color: 'var(--text-dim)' }}>No sessions</div>
        ) : (
          lineageRows.map(row => (
            <SessionRow
              key={row.session.id}
              session={row.session}
              depth={row.depth}
              parent={row.parent}
              isSelected={row.session.id === selectedId}
              onClick={() => onSelect(row.session.id)}
              isThinking={llmActive?.has(row.session.id)}
              activeToolCount={sessionActiveTasks?.get(row.session.id)?.size ?? 0}
              onRename={onRename}
            />
          ))
        )}
      </div>

      <div className="flex-none px-3 py-2 border-t text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
        <div className="flex items-center justify-between gap-2">
          <span>{filteredSessions.length} of {sessions.length}</span>
          <button
            onClick={() => setRenameOpen(v => !v)}
            className="px-2 py-0.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-elev)' }}
            title="AI batch rename visible sessions"
          >
            AI Rename
          </button>
        </div>
      </div>

      {renameOpen && (
        <div className="flex-none border-t p-2.5 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            AI Batch Rename
          </div>
          <textarea
            value={renameInstructions}
            onChange={(e) => setRenameInstructions(e.target.value)}
            rows={2}
            className="w-full rounded border px-2 py-1 text-[11px] outline-none resize-none"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
            placeholder="Optional naming instructions..."
          />
          <div className="flex items-center gap-2">
            <button
              disabled={renameLoading || renameApplying || lineageRows.length === 0}
              onClick={async () => {
                setRenameLoading(true)
                setRenameError('')
                try {
                  const ids = lineageRows.slice(0, 30).map(r => r.session.id)
                  const res = await fetch('/api/sessions/batch-rename/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      session_ids: ids,
                      instructions: renameInstructions,
                    }),
                  })
                  const data = await res.json()
                  if (!data?.ok) {
                    setRenameItems([])
                    setRenameError(data?.error || 'failed to generate suggestions')
                    return
                  }
                  const mapped = (data.suggestions || []).map(s => ({ ...s, apply: true, status: '' }))
                  setRenameItems(mapped)
                  if (mapped.length === 0) setRenameError('No rename suggestions returned')
                } catch (_) {
                  setRenameItems([])
                  setRenameError('network error')
                } finally {
                  setRenameLoading(false)
                }
              }}
              className="px-2 py-1 rounded border text-[11px]"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {renameLoading ? 'Generating...' : `Suggest (${Math.min(30, lineageRows.length)})`}
            </button>
            <button
              disabled={renameApplying || renameLoading || renameItems.filter(i => i.apply).length === 0}
              onClick={async () => {
                setRenameApplying(true)
                setRenameError('')
                const next = []
                for (const item of renameItems) {
                  if (!item.apply) {
                    next.push(item)
                    continue
                  }
                  const res = await onRename(item.id, item.title)
                  next.push({ ...item, status: res?.ok ? 'ok' : (res?.error || 'failed') })
                }
                setRenameItems(next)
                setRenameApplying(false)
              }}
              className="px-2 py-1 rounded border text-[11px]"
              style={{ borderColor: 'var(--accent)', color: 'var(--text)' }}
            >
              {renameApplying ? 'Applying...' : 'Apply'}
            </button>
          </div>

          {renameError && (
            <div className="text-[11px]" style={{ color: '#ef4444' }}>{renameError}</div>
          )}

          {renameItems.length > 0 && (
            <div className="max-h-44 overflow-auto border rounded" style={{ borderColor: 'var(--border)' }}>
              {renameItems.map((item, idx) => (
                <label
                  key={`${item.id}-${idx}`}
                  className="flex items-start gap-2 px-2 py-1.5 border-b text-[11px]"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <input
                    type="checkbox"
                    checked={item.apply}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setRenameItems(prev => prev.map((v, i) => i === idx ? { ...v, apply: checked } : v))
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ color: 'var(--text-dim)' }}>
                      {item.current_title || `…${String(item.id).slice(-10)}`}
                    </div>
                    <div className="truncate" style={{ color: 'var(--text)' }}>
                      {item.title}
                    </div>
                  </div>
                  {item.status && (
                    <span style={{ color: item.status === 'ok' ? 'var(--ok)' : '#ef4444' }}>
                      {item.status === 'ok' ? 'ok' : 'err'}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function SessionRow({ session, depth, parent, isSelected, onClick, isThinking, activeToolCount, onRename }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const isActive   = !session.ended_at
  const model      = fmtModel(session.model)
  const duration   = fmtDuration(session.started_at, session.ended_at)
  const toolCount  = session.tool_call_count ?? 0
  const totalTokens = (session.input_tokens ?? 0) + (session.output_tokens ?? 0)
  const srcColor   = SOURCE_COLORS[session.source] ?? '#6b7280'
  const hasParent  = !!session.parent_session_id
  const inferredParent = !!session._lineage_inferred
  const endReason  = session.end_reason

  const displayName = session.title
    ? (session.title.length > 24 ? session.title.slice(0, 23) + '\u2026' : session.title)
    : (session.id ? ('\u2026' + session.id.slice(-12)) : '\u2014')

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = (e) => {
    e.stopPropagation()
    setEditValue(session.title || '')
    setError(null)
    setEditing(true)
  }

  const commitEdit = async () => {
    const trimmed = editValue.trim()
    if (trimmed === (session.title || '')) {
      setEditing(false)
      return
    }
    const result = await onRename(session.id, trimmed)
    if (result?.ok) {
      setEditing(false)
      setError(null)
    } else {
      setError(result?.error || 'failed')
    }
  }

  const handleKeyDown = (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') setEditing(false)
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 border-b cursor-pointer select-none transition-colors"
      style={{
        paddingTop: 9,
        paddingBottom: 9,
        paddingLeft: 12 + Math.min(6, depth) * 14,
        borderColor: 'var(--border)',
        background: isSelected ? 'color-mix(in oklab, var(--accent) 12%, var(--panel) 88%)' : 'transparent',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="relative flex-none">
          <span
            className={`block w-2 h-2 rounded-full ${isActive ? 'pulse-dot' : ''}`}
            style={{ background: isActive ? '#22c55e' : '#28282c' }}
          />
          {isThinking && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full thinking-ring" style={{ background: 'rgba(21,88,56,0.3)' }} />
          )}
        </span>

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => { setEditValue(e.target.value); setError(null) }}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-[13px] outline-none border-b"
            style={{
              color: 'var(--text)',
              borderColor: error ? '#ef4444' : 'var(--accent)',
              caretColor: 'var(--accent)',
            }}
            maxLength={100}
            placeholder="Session title..."
          />
        ) : (
          <span
            className="text-[13px] truncate flex-1"
            style={{ color: isSelected ? 'var(--text)' : 'var(--text-muted)' }}
            onDoubleClick={startEdit}
            title="Double-click to rename"
          >
            {displayName}
          </span>
        )}

        <span
          className="text-[10px] px-1.5 py-0.5 rounded flex-none"
          style={{ color: srcColor, background: srcColor + '18' }}
        >
          {session.source ?? '?'}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded flex-none uppercase tracking-wide"
          style={{
            color: hasParent ? 'var(--accent-2)' : 'var(--text-dim)',
            background: hasParent ? 'color-mix(in oklab, var(--accent-2) 20%, transparent)' : 'color-mix(in oklab, var(--border) 70%, transparent)',
          }}
        >
          {hasParent ? `sub ${depth}` : 'root'}
        </span>
        {inferredParent && (
          <span className="text-[10px] px-1.5 py-0.5 rounded flex-none" style={{ color: 'var(--warn)', background: 'color-mix(in oklab, var(--warn) 15%, transparent)' }}>
            inferred
          </span>
        )}
      </div>

      {error && (
        <div className="text-[10px] mb-1" style={{ color: '#ef4444' }}>{error}</div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>
          {hasParent && parent ? `from ${compactLabel(parent.title || parent.id)}` : model}
        </span>
        <div className="flex items-center gap-2 text-[11px] flex-none ml-1" style={{ color: 'var(--text-dim)' }}>
          {hasParent && (
            <span style={{ color: 'var(--accent-2)' }}>{inferredParent ? 'fork?' : 'fork'}</span>
          )}
          {activeToolCount > 0 && (
            <span style={{ color: 'var(--warn)' }}>{activeToolCount} running</span>
          )}
          {isThinking && (
            <span style={{ color: 'var(--accent)' }}>thinking</span>
          )}
          {!isActive && endReason && (
            <span style={{ color: 'var(--text-dim)' }}>{compactEndReason(endReason)}</span>
          )}
          {toolCount > 0 && <span>{toolCount}t</span>}
          {totalTokens > 0 && <span>{fmtCompactNum(totalTokens)} tok</span>}
          {duration && <span>{duration}</span>}
        </div>
      </div>
    </button>
  )
}

function buildLineageRows(sessions) {
  const byId = new Map(sessions.map(s => [s.id, s]))
  const children = new Map()
  for (const s of sessions) {
    if (!s.parent_session_id || !byId.has(s.parent_session_id)) continue
    if (!children.has(s.parent_session_id)) children.set(s.parent_session_id, [])
    children.get(s.parent_session_id).push(s)
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
  }
  const roots = sessions
    .filter(s => !s.parent_session_id || !byId.has(s.parent_session_id))
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))

  const rows = []
  const walk = (session, depth, parent) => {
    rows.push({ session, depth, parent })
    for (const child of children.get(session.id) || []) {
      walk(child, depth + 1, session)
    }
  }
  for (const root of roots) walk(root, 0, null)
  return rows
}

function compactLabel(value) {
  if (!value) return '\u2014'
  const text = String(value)
  if (text.length <= 18) return text
  return text.slice(0, 17) + '\u2026'
}

function compactEndReason(reason) {
  if (!reason) return ''
  if (reason === 'cli_close') return 'closed'
  if (reason === 'new_session') return 'new'
  if (reason === 'compression') return 'compressed'
  return reason.length > 10 ? reason.slice(0, 10) + '\u2026' : reason
}

function fmtModel(model) {
  if (!model) return '\u2014'
  const name = model.includes('/') ? model.split('/').pop() : model.replace('claude-', '')
  return name.length > 16 ? name.slice(0, 15) + '\u2026' : name
}

function fmtDuration(start, end) {
  if (!start) return null
  const secs = (end ?? Date.now() / 1000) - start
  if (secs < 60) return `${secs.toFixed(0)}s`
  if (secs < 3600) return `${(secs / 60).toFixed(1)}m`
  return `${(secs / 3600).toFixed(1)}h`
}

function fmtCompactNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
