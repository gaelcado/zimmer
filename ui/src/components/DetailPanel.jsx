import { useState, useMemo, useRef, useEffect } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, StopCircleIcon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { toolColor } from '../lib/colors.js'

export default function DetailPanel({ block, session, childCountBySession, onClose, onKillSession, onRename, llmActive }) {
  if (!block && !session) {
    return (
      <aside className="flex-none w-80 border-l flex items-center justify-center" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <p className="text-[12px] text-center px-5 leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          Select a session or tool call
        </p>
      </aside>
    )
  }

  if (block) {
    return <BlockDetail block={block} onClose={onClose} />
  }

  return (
    <SessionDetail
      session={session}
      childCountBySession={childCountBySession}
      onClose={onClose}
      onKillSession={onKillSession}
      onRename={onRename}
      llmActive={llmActive}
    />
  )
}

function BlockDetail({ block, onClose }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const isTurn = !!block._turn
  const subcalls = isTurn ? (block._subcalls ?? []) : [block]
  const selected = subcalls[Math.max(0, Math.min(selectedIdx, subcalls.length - 1))] ?? null
  const color = toolColor(selected?.tool_name ?? block.tool_name)
  const duration = block.ended_at
    ? `${((block.ended_at - block.started_at) * 1000).toFixed(0)}ms`
    : 'in progress...'

  let argsStr = ''
  try {
    argsStr = typeof selected?.args === 'string'
      ? JSON.stringify(JSON.parse(selected.args), null, 2)
      : JSON.stringify(selected?.args, null, 2)
  } catch {
    argsStr = String(selected?.args ?? '')
  }

  return (
    <aside className="flex-none w-80 border-l flex flex-col overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-sm flex-none" style={{ background: color }} />
          <span className="text-[13px] font-semibold truncate" style={{ color }}>
            {isTurn ? `Turn \u00B7 ${subcalls.length} tools` : (block.tool_name ?? 'unknown')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className="text-[11px]" style={{ color: block.ended_at ? 'var(--text-dim)' : 'var(--ok)' }}>{duration}</span>
          <button onClick={onClose} className="flex items-center" style={{ color: 'var(--text-dim)' }}><HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" /></button>
        </div>
      </div>

      {isTurn && subcalls.length > 1 && (
        <div className="flex-none px-3 py-2 border-b space-y-1" style={{ borderColor: 'var(--border)' }}>
          {subcalls.map((sub, idx) => {
            const active = idx === selectedIdx
            const subDur = sub.ended_at
              ? `${((sub.ended_at - sub.started_at) * 1000).toFixed(0)}ms`
              : 'running'
            return (
              <button
                key={`${sub.tool_name ?? 'tool'}-${sub.started_at ?? 0}-${idx}`}
                onClick={() => setSelectedIdx(idx)}
                className="w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between gap-2"
                style={{
                  background: active ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <span className="truncate">{sub.tool_name ?? 'unknown'}</span>
                <span className="flex-none" style={{ color: 'var(--text-dim)' }}>{subDur}</span>
              </button>
            )
          })}
        </div>
      )}

      <Section label="Arguments">
        {argsStr ? (
          <FormattedCode content={argsStr} />
        ) : (
          <Muted>none</Muted>
        )}
      </Section>

      <Section label="Result" flex>
        {selected?.result_preview ? (
          <FormattedCode content={selected.result_preview} />
        ) : (
          <Muted>{selected?.ended_at ? 'no preview' : 'waiting...'}</Muted>
        )}
      </Section>
    </aside>
  )
}

function SessionDetail({ session, childCountBySession, onClose, onKillSession, onRename, llmActive }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  if (!session) return null
  const isActive = !session.ended_at
  const isThinking = llmActive?.has(session.id)
  const tokens = (session.input_tokens ?? 0) + (session.output_tokens ?? 0)
  const cacheTokens = (session.cache_read_tokens ?? 0) + (session.cache_write_tokens ?? 0)
  const reasoningTokens = session.reasoning_tokens ?? 0
  const childCount = childCountBySession?.get(session.id) ?? 0
  const cost = session.estimated_cost_usd
  const actualCost = session.actual_cost_usd

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = () => {
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
    <aside className="flex-none w-80 border-l flex flex-col overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          {isThinking && <span className="text-[11px]" style={{ color: 'var(--accent)' }}>thinking</span>}
          {isActive && !isThinking && <span className="text-[11px]" style={{ color: 'var(--ok)' }}>active</span>}
          {!isActive && <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>ended</span>}
        </div>
        <button onClick={onClose} className="flex items-center" style={{ color: 'var(--text-dim)' }}><HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" /></button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2.5 text-[12px]">
        <div className="pb-1" style={{ borderBottom: '1px solid var(--border)' }}>
          {editing ? (
            <div>
              <input
                ref={inputRef}
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setError(null) }}
                onKeyDown={handleKeyDown}
                onBlur={commitEdit}
                className="w-full bg-transparent text-[13px] font-medium outline-none border-b pb-0.5"
                style={{
                  color: 'var(--text)',
                  borderColor: error ? '#ef4444' : 'var(--accent)',
                  caretColor: 'var(--accent)',
                }}
                maxLength={100}
                placeholder="Session title..."
              />
              {error && <div className="text-[10px] mt-1" style={{ color: '#ef4444' }}>{error}</div>}
            </div>
          ) : (
            <div
              className="text-[13px] font-medium cursor-pointer flex items-center gap-1.5 group"
              style={{ color: session.title ? 'var(--text)' : 'var(--text-dim)' }}
              onClick={startEdit}
              title="Click to rename"
            >
              <span className="flex-1">{session.title || 'Untitled — click to name'}</span>
              <span className="opacity-0 group-hover:opacity-50 transition-opacity flex-none">
                <HugeiconsIcon icon={PencilEdit01Icon} size={11} color="currentColor" />
              </span>
            </div>
          )}
        </div>

        <Row label="ID" value={'...' + (session.id?.slice(-14) ?? '?')} mono />
        <Row label="Model" value={session.model ?? '\u2014'} />
        {session.parent_session_id && <Row label="Parent" value={'...' + session.parent_session_id.slice(-14)} mono />}
        {childCount > 0 && <Row label="Children" value={childCount} />}

        <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          <Row label="Input" value={fmtNum(session.input_tokens ?? 0)} />
          <Row label="Output" value={fmtNum(session.output_tokens ?? 0)} />
          {cacheTokens > 0 && <Row label="Cache" value={fmtNum(cacheTokens)} />}
          {reasoningTokens > 0 && <Row label="Reasoning" value={fmtNum(reasoningTokens)} />}
          <Row label="Total" value={fmtNum(tokens)} highlight />
        </div>

        {(cost != null || actualCost != null) && (
          <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            {cost != null && <Row label="Estimated" value={`$${cost.toFixed(4)}`} />}
            {actualCost != null && <Row label="Billed" value={`$${actualCost.toFixed(4)}`} />}
            {session.cost_status && <Row label="Status" value={session.cost_status} />}
          </div>
        )}

        {session.end_reason && (
          <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <Row label="End reason" value={session.end_reason} />
          </div>
        )}
      </div>

      {isActive && onKillSession && (
        <div className="flex-none px-3 pb-3">
          <button
            onClick={() => onKillSession(session.id)}
            className="w-full py-1.5 rounded text-[11px] uppercase tracking-wide border transition-colors flex items-center justify-center gap-1.5"
            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
          >
            <HugeiconsIcon icon={StopCircleIcon} size={12} color="currentColor" />
            Kill session
          </button>
        </div>
      )}
    </aside>
  )
}

function Section({ label, children, flex }) {
  return (
    <div className={`flex flex-col border-b ${flex ? 'flex-1 min-h-0' : 'flex-none'}`} style={{ borderColor: 'var(--border)' }}>
      <div className="px-3 py-1 text-[10px] uppercase tracking-widest flex-none" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div className={`px-3 py-2 ${flex ? 'overflow-y-auto flex-1' : ''}`}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, mono, highlight }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="flex-none text-[11px]" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span
        className={`text-right truncate text-[11px] ${mono ? 'font-mono' : ''}`}
        style={{ color: highlight ? 'var(--text)' : 'var(--text-muted)' }}
      >
        {value}
      </span>
    </div>
  )
}

function Muted({ children }) {
  return <span className="italic text-[11px]" style={{ color: 'var(--text-dim)' }}>{children}</span>
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function FormattedCode({ content }) {
  const lines = useMemo(() => {
    const text = typeof content === 'string' ? content : String(content)
    return text.split('\n')
  }, [content])

  const isJson = useMemo(() => {
    const t = (typeof content === 'string' ? content : '').trimStart()
    return t.startsWith('{') || t.startsWith('[')
  }, [content])

  return (
    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
      {lines.map((line, i) => (
        <CodeLine key={i} line={line} isJson={isJson} />
      ))}
    </pre>
  )
}

function CodeLine({ line, isJson }) {
  if (isJson) {
    const m = line.match(/^(\s*)"([^"]+)"(:)(.*)$/)
    if (m) {
      return (
        <div>
          <span>{m[1]}</span>
          <span style={{ color: 'var(--accent-2)' }}>"{m[2]}"</span>
          <span style={{ color: 'var(--text-dim)' }}>{m[3]}</span>
          <JsonVal text={m[4]} />
        </div>
      )
    }
    return <div><JsonVal text={line} /></div>
  }
  return <div style={{ color: 'var(--text-muted)' }}>{line}</div>
}

function JsonVal({ text }) {
  const trimmed = text.trim().replace(/,$/, '')
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return <span style={{ color: 'var(--warn)' }}>{text}</span>
  if (/^-?\d+(\.\d+)?/.test(trimmed)) return <span style={{ color: 'var(--ok)' }}>{text}</span>
  if (trimmed.startsWith('"')) return <span style={{ color: '#fb7185' }}>{text}</span>
  return <span style={{ color: 'var(--text-muted)' }}>{text}</span>
}
