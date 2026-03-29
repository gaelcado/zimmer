/**
 * Conversation message viewer for a selected session.
 * Fetches from /api/sessions/{id}/messages and renders chat-style.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { marked } from 'marked'

const ROLE_STYLES = {
  system:    { label: 'SYS',  color: '#71717a' },
  user:      { label: 'USER', color: 'var(--accent)' },
  assistant: { label: 'AI',   color: 'var(--ok)' },
  tool:      { label: 'TOOL', color: 'var(--warn)' },
}

export default function MessagesPanel({ sessionId }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(50)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    fetch(`/api/sessions/${sessionId}/messages?limit=${limit}`)
      .then(r => r.json())
      .then(d => {
        setMessages(Array.isArray(d) ? d : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sessionId, limit])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-[13px]" style={{ color: 'var(--text-dim)' }}>
        Select a session to view messages
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
          Messages ({messages.length})
        </span>
        <div className="flex items-center gap-2">
          {messages.length >= limit && (
            <button
              onClick={() => setLimit(l => l + 50)}
              className="text-[11px] px-2 py-0.5 rounded border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Load more
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-2 space-y-1.5">
        {loading && messages.length === 0 ? (
          <div className="text-[12px] py-8 text-center" style={{ color: 'var(--text-dim)' }}>Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-[12px] py-8 text-center italic" style={{ color: 'var(--text-dim)' }}>No messages</div>
        ) : (
          messages.map((msg, idx) => <MessageBubble key={idx} msg={msg} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function MessageBubble({ msg }) {
  const [expanded, setExpanded] = useState(false)
  const roleStyle = ROLE_STYLES[msg.role] ?? ROLE_STYLES.system
  const content = msg.content || ''
  const isTruncated = content.endsWith('…') && content.length >= 499
  const displayContent = expanded ? content : content
  const time = msg.timestamp
    ? new Date(msg.timestamp * 1000).toLocaleTimeString()
    : ''
  const tokenCount = msg.token_count ?? 0

  return (
    <div
      className="rounded-lg px-3 py-2 border"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: roleStyle.color, background: `color-mix(in oklab, ${roleStyle.color} 15%, transparent)` }}
          >
            {roleStyle.label}
          </span>
          {msg.tool_name && (
            <span className="text-[11px]" style={{ color: 'var(--warn)' }}>
              {msg.tool_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
          {tokenCount > 0 && <span className="text-[10px]">{fmtCompactNum(tokenCount)} tok</span>}
          <span className="text-[10px]">{time}</span>
        </div>
      </div>
      {content ? (
        <MessageContent content={displayContent} role={msg.role} />
      ) : (
        <span className="text-[11px] italic" style={{ color: 'var(--text-dim)' }}>
          {msg.role === 'assistant' ? '(tool calls only)' : '(empty)'}
        </span>
      )}
      {isTruncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] mt-1"
          style={{ color: 'var(--accent)' }}
        >
          {expanded ? 'collapse' : 'truncated (server-side)'}
        </button>
      )}
    </div>
  )
}

function MessageContent({ content, role }) {
  const html = useMemo(() => {
    if (role !== 'assistant') return null
    try { return marked.parse(content || '') }
    catch { return null }
  }, [content, role])

  const formatted = useMemo(() => {
    if (role !== 'tool') return null
    const t = (content || '').trimStart()
    if (!t.startsWith('{') && !t.startsWith('[')) return null
    try { return JSON.stringify(JSON.parse(content), null, 2) }
    catch { return null }
  }, [content, role])

  if (html) {
    return (
      <div
        className="prose-zimmer text-[11px] leading-relaxed"
        style={{ color: 'var(--text-muted)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (formatted) {
    return (
      <pre
        className="text-[11px] leading-relaxed whitespace-pre-wrap break-words"
        style={{ color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}
      >
        {formatted}
      </pre>
    )
  }

  return (
    <pre
      className="text-[11px] leading-relaxed whitespace-pre-wrap break-words"
      style={{ color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}
    >
      {content}
    </pre>
  )
}

function fmtCompactNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
