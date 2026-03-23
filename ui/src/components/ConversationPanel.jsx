/**
 * Unified turns + messages panel.
 * Turns default to collapsed; click to expand and see messages inline.
 */

import { useState, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import { useToolMeta, toolEmoji } from '../lib/toolMeta.js'

const ROLE_STYLES = {
  system:    { label: 'SYS',  color: '#71717a' },
  user:      { label: 'USER', color: 'var(--accent)' },
  assistant: { label: 'AI',   color: 'var(--ok)' },
  tool:      { label: 'TOOL', color: 'var(--warn)' },
}

export default function ConversationPanel({ sessionId, turns = [], selectedTurn, onSelectTurn }) {
  const toolMeta = useToolMeta()
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [expandedTurns, setExpandedTurns] = useState(new Set())

  useEffect(() => {
    if (!sessionId) { setMessages([]); return }
    setLoadingMsgs(true)
    fetch(`/api/sessions/${sessionId}/messages?limit=500`)
      .then(r => r.json())
      .then(d => { setMessages(Array.isArray(d) ? d : []); setLoadingMsgs(false) })
      .catch(() => setLoadingMsgs(false))
  }, [sessionId])

  // Reset expansions when session changes
  useEffect(() => { setExpandedTurns(new Set()) }, [sessionId])

  const toggleTurn = (idx) =>
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })

  const allCollapsed = expandedTurns.size === 0

  const toggleAll = () => {
    if (allCollapsed) setExpandedTurns(new Set(turns.map((_, i) => i)))
    else setExpandedTurns(new Set())
  }

  // Messages grouped by turn via exact ID matching
  const { preTurnMessages, msgsByTurn } = useMemo(() => {
    // turn_id → turn index (matches assistant message that spawned the turn)
    const byTurnId = new Map(turns.map((t, i) => [t._turn_id, i]))

    // call_id → turn index (matches tool result messages)
    const byCallId = new Map()
    turns.forEach((t, i) => {
      for (const sub of t._subcalls || []) {
        if (sub.call_id) byCallId.set(sub.call_id, i)
      }
    })

    const groups = turns.map(() => [])
    const unmatched = []

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.id != null) {
        const idx = byTurnId.get(msg.id)
        if (idx !== undefined) { groups[idx].push(msg); continue }
      } else if (msg.role === 'tool' && msg.tool_call_id) {
        const idx = byCallId.get(msg.tool_call_id)
        if (idx !== undefined) { groups[idx].push(msg); continue }
      }
      unmatched.push(msg)
    }

    return { preTurnMessages: unmatched, msgsByTurn: groups }
  }, [messages, turns])

  // Interleave unmatched messages and turns by timestamp so the timeline
  // reflects actual execution order (tools appear before the final AI response)
  const timeline = useMemo(() => {
    const items = preTurnMessages.map(msg => ({ type: 'msg', msg, ts: msg.timestamp || 0 }))
    turns.forEach((turn, idx) => items.push({ type: 'turn', turn, idx, ts: turn.started_at || 0 }))
    return items.sort((a, b) => a.ts - b.ts)
  }, [preTurnMessages, turns])

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-[12px]" style={{ color: 'var(--text-dim)' }}>
        Select a session
      </div>
    )
  }

  const hasContent = turns.length > 0 || messages.length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-3 h-8 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {turns.length} turns
          {messages.length > 0 && <span style={{ color: 'var(--text-dim)' }}> · {messages.length} msgs</span>}
        </span>
        {turns.length > 0 && (
          <button
            onClick={toggleAll}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: 'var(--text-dim)', background: 'var(--bg-elev-2)' }}
          >
            {allCollapsed ? 'expand all' : 'collapse all'}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-2 space-y-px">
        {/* Interleaved timeline: messages and turns sorted by timestamp */}
        {timeline.map((item, i) => {
          if (item.type === 'msg') {
            return <MessageRow key={`msg-${i}`} msg={item.msg} nested={false} />
          }

          const { turn, idx } = item
          const isSelected = selectedTurn &&
            selectedTurn.started_at === turn.started_at &&
            selectedTurn._tool_count === turn._tool_count
          const isExpanded = expandedTurns.has(idx)
          const subcalls = turn._subcalls || []
          const tools = [...new Set(subcalls.map(t => t.tool_name).filter(Boolean))]
          const dur = fmtTurnDur(turn)
          const turnMsgs = msgsByTurn[idx] || []
          const preview = subcalls.find(s => s.preview)?.preview || null
          const emojis = [...new Set(tools.map(t => toolEmoji(t, toolMeta)))]

          return (
            <div key={`turn-${idx}`} className="space-y-px">
              <button
                onClick={() => { onSelectTurn(turn); toggleTurn(idx) }}
                className="w-full text-left rounded border px-2.5 py-2 transition-colors"
                style={{
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  background: isSelected
                    ? 'color-mix(in oklab, var(--accent) 12%, var(--panel) 88%)'
                    : 'var(--panel)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="flex-none">{emojis.join('')}</span>
                      <span className="text-[11px] truncate" style={{ color: isSelected ? 'var(--text)' : 'var(--text-muted)' }}>
                        {tools.join(' · ') || 'unknown'}
                        <span style={{ color: 'var(--text-dim)' }}> ×{turn._tool_count || 0}</span>
                      </span>
                    </div>
                    {preview && (
                      <div className="text-[10px] truncate mt-0.5 font-mono" style={{ color: 'var(--text-dim)' }}>
                        {preview}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    {turnMsgs.length > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{turnMsgs.length}m</span>
                    )}
                    <span className="text-[10px]" style={{ color: turn.ended_at ? 'var(--text-dim)' : 'var(--ok)' }}>
                      {dur}
                    </span>
                    <ChevronIcon open={isExpanded} />
                  </div>
                </div>
                {subcalls.length > 1 && <TurnRibbon subcalls={subcalls} />}
              </button>

              {isExpanded && turnMsgs.length > 0 && (
                <div
                  className="ml-3 space-y-px pb-0.5"
                  style={{ borderLeft: '2px solid var(--border)' }}
                >
                  {turnMsgs.map((msg, mi) => (
                    <MessageRow key={`t${idx}-m${mi}`} msg={msg} nested />
                  ))}
                </div>
              )}
              {isExpanded && turnMsgs.length === 0 && (
                <div className="ml-3 py-1 text-[11px] italic" style={{ color: 'var(--text-dim)' }}>
                  no messages recorded
                </div>
              )}
            </div>
          )
        })}

        {!hasContent && (
          <div className="py-8 text-center text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {loadingMsgs ? 'Loading...' : 'No turns yet'}
          </div>
        )}
      </div>
    </div>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="10" height="10"
      viewBox="0 0 10 10"
      style={{ color: 'var(--text-dim)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TurnRibbon({ subcalls }) {
  if (!subcalls.length) return null
  const first = Math.min(...subcalls.map(s => s.started_at || 0))
  const last = Math.max(...subcalls.map(s => s.ended_at || s.started_at || 0), first + 0.01)
  const span = Math.max(0.01, last - first)

  return (
    <div className="mt-1.5 rounded overflow-hidden relative" style={{ height: 5, background: 'var(--bg-elev-2)' }}>
      {subcalls.map((s, i) => {
        const left = ((s.started_at - first) / span) * 100
        const end = s.ended_at || (s.started_at + span * 0.05)
        const width = Math.max(2.5, ((end - s.started_at) / span) * 100)
        const hue = (hashCode(s.tool_name || 'tool') % 240) + 80
        return (
          <div
            key={`${s.tool_name || 'tool'}-${s.started_at}-${i}`}
            className="absolute top-0 h-full rounded-sm"
            style={{ left: `${left}%`, width: `${width}%`, background: `hsl(${hue} 70% 55%)`, opacity: s.ended_at ? 0.8 : 1 }}
          />
        )
      })}
    </div>
  )
}

function MessageRow({ msg, nested }) {
  const [collapsed, setCollapsed] = useState(true)
  const roleStyle = ROLE_STYLES[msg.role] ?? ROLE_STYLES.system
  const content = msg.content || ''
  const time = msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : ''
  const tokenCount = msg.token_count ?? 0

  const html = useMemo(() => {
    if (msg.role !== 'assistant') return null
    try { return marked.parse(content) } catch { return null }
  }, [content, msg.role])

  const formatted = useMemo(() => {
    if (msg.role !== 'tool') return null
    const t = content.trimStart()
    if (!t.startsWith('{') && !t.startsWith('[')) return null
    try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return null }
  }, [content, msg.role])

  const isLong = content.length > 300
  const displayContent = isLong && collapsed ? content.slice(0, 300) + '…' : content

  return (
    <div
      className={`rounded border px-2.5 py-1.5 ${nested ? 'ml-2' : ''}`}
      style={{ borderColor: 'var(--border)', background: nested ? 'var(--bg-elev)' : 'var(--panel)' }}
    >
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[9px] font-bold px-1 py-0.5 rounded flex-none"
            style={{ color: roleStyle.color, background: `color-mix(in oklab, ${roleStyle.color} 15%, transparent)` }}
          >
            {roleStyle.label}
          </span>
          {msg.tool_name && (
            <span className="text-[10px] truncate" style={{ color: 'var(--warn)' }}>{msg.tool_name}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-none" style={{ color: 'var(--text-dim)' }}>
          {tokenCount > 0 && <span className="text-[9px]">{fmtCompactNum(tokenCount)} tok</span>}
          <span className="text-[9px]">{time}</span>
        </div>
      </div>

      {content ? (
        <>
          {html ? (
            <div
              className="prose-zimmer text-[11px] leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
              dangerouslySetInnerHTML={{ __html: isLong && collapsed ? marked.parse(content.slice(0, 300) + '…') : html }}
            />
          ) : formatted ? (
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}>
              {isLong && collapsed ? formatted.slice(0, 300) + '…' : formatted}
            </pre>
          ) : (
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}>
              {displayContent}
            </pre>
          )}
          {isLong && (
            <button
              onClick={() => setCollapsed(v => !v)}
              className="text-[10px] mt-0.5"
              style={{ color: 'var(--accent)' }}
            >
              {collapsed ? 'show more' : 'show less'}
            </button>
          )}
        </>
      ) : (
        <span className="text-[11px] italic" style={{ color: 'var(--text-dim)' }}>
          {msg.role === 'assistant' ? '(tool calls only)' : '(empty)'}
        </span>
      )}
    </div>
  )
}

function fmtTurnDur(turn) {
  const start = turn.started_at || 0
  const end = turn.ended_at || Date.now() / 1000
  const s = Math.max(0, end - start)
  if (!turn.ended_at) return `${s.toFixed(0)}s`
  if (s < 1) return `${Math.round(s * 1000)}ms`
  if (s < 60) return `${s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function fmtCompactNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
