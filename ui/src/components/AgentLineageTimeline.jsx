import { useMemo, useRef, useState, useEffect } from 'react'

const LEFT_GUTTER = 290
const RIGHT_PAD = 34
const TOP_PAD = 20

const SRC = {
  cli:        '#155838',
  telegram:   '#38bdf8',
  discord:    '#818cf8',
  gateway:    '#71717a',
  signal:     '#2a9c6b',
  dingtalk:   '#1677ff',
  sms:        '#f59e0b',
  mattermost: '#0058cc',
  matrix:     '#0dbd8b',
  webhook:    '#8b5cf6',
}

export default function AgentLineageTimeline({
  sessions,
  selectedSessionId,
  onSelectSession,
  llmActive,
  sessionActiveTasks,
  sessionTurnGroups = new Map(),
  selectedTurn,
  onSelectTurn,
}) {
  const hostRef = useRef(null)
  const [width, setWidth] = useState(1200)
  const rowH = 72

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect?.width
      if (next) setWidth(next)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const graph = useMemo(() => buildLineageGraph(sessions), [sessions])
  const now = Date.now() / 1000
  const minTs = graph.rows.length ? Math.min(...graph.rows.map(r => r.session.started_at || now)) : now - 60
  const maxTs = graph.rows.length
    ? Math.max(...graph.rows.map(r => r.session.ended_at || now), now)
    : now + 10
  const span = Math.max(1, maxTs - minTs)
  const blockW = Math.max(320, width - LEFT_GUTTER - RIGHT_PAD)
  const totalH = Math.max(240, TOP_PAD + graph.rows.length * rowH + 24)
  const tsToX = (ts) => LEFT_GUTTER + ((ts - minTs) / span) * blockW

  return (
    <div ref={hostRef} className="h-full w-full overflow-auto" style={{ background: 'var(--bg)' }}>
      <svg width={width} height={totalH}>
        <rect x="0" y="0" width={width} height={totalH} fill="var(--bg)" />

        {graph.rows.map((row, idx) => {
          const y = TOP_PAD + idx * rowH
          return <line key={`row-${row.session.id}`} x1={0} y1={y + rowH - 1} x2={width} y2={y + rowH - 1} stroke="var(--border)" strokeWidth="1" opacity="0.45" />
        })}

        {graph.rows.map((row, idx) => {
          if (!row.parentId) return null
          const parent = graph.index.get(row.parentId)
          if (!parent) return null
          const y = TOP_PAD + idx * rowH + rowH * 0.5
          const py = TOP_PAD + parent.row * rowH + rowH * 0.5
          const branchX = 20 + row.depth * 20
          return (
            <g key={`tree-branch-${row.session.id}`}>
              <line x1={branchX - 10} y1={Math.min(py, y)} x2={branchX - 10} y2={Math.max(py, y)} stroke="var(--text-dim)" strokeWidth="1" opacity="0.45" />
              <line x1={branchX - 10} y1={y} x2={branchX - 1} y2={y} stroke="var(--text-dim)" strokeWidth="1" opacity="0.45" />
            </g>
          )
        })}

        {graph.edges.map((edge) => {
          const parent = graph.index.get(edge.parent)
          const child = graph.index.get(edge.child)
          if (!parent || !child) return null
          const pY = TOP_PAD + parent.row * rowH + rowH * 0.5
          const cY = TOP_PAD + child.row * rowH + rowH * 0.5
          const pX = tsToX(parent.session.started_at || minTs) + 5
          const cX = tsToX(child.session.started_at || minTs) - 5
          const mx = pX + (cX - pX) * 0.5
          const d = `M ${pX} ${pY} C ${mx} ${pY}, ${mx} ${cY}, ${cX} ${cY}`
          return <path key={`${edge.parent}->${edge.child}`} d={d} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" opacity="0.45" />
        })}

        {graph.rows.map((row, idx) => {
          const s = row.session
          const y = TOP_PAD + idx * rowH
          const x1 = tsToX(s.started_at || minTs)
          const x2 = tsToX(s.ended_at || now)
          const barW = Math.max(28, x2 - x1)
          const depthX = 20 + row.depth * 20
          const color = SRC[s.source] || '#71717a'
          const isSelected = s.id === selectedSessionId
          const running = !s.ended_at
          const thinking = llmActive?.has(s.id)
          const taskCount = sessionActiveTasks?.get(s.id)?.size ?? 0
          const label = s.title || `…${String(s.id).slice(-10)}`
          const turns = sessionTurnGroups.get(s.id) || []
          const parentMeta = row.parentId ? graph.index.get(row.parentId) : null
          const parentLabel = parentMeta?.session?.title || `…${String(parentMeta?.session?.id ?? '').slice(-8)}`
          const roleLabel = row.parentId ? `subagent d${row.depth}` : 'root agent'
          const childCount = graph.directChildrenCount.get(s.id) ?? 0
          const inferred = !!s._lineage_inferred
          const totalTokens = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)

          return (
            <g key={s.id}>
              <g onClick={() => onSelectSession(s.id)} style={{ cursor: 'pointer' }}>
                {row.parentId ? (
                  <rect x={depthX - 4} y={y + rowH * 0.5 - 4} width={8} height={8} rx={2} fill={running ? 'var(--ok)' : 'var(--text-dim)'} />
                ) : (
                  <circle cx={depthX} cy={y + rowH * 0.5} r={4.4} fill={running ? 'var(--ok)' : 'var(--text-dim)'} />
                )}
                <text x={depthX + 11} y={y + 23} fill={isSelected ? 'var(--text)' : 'var(--text-muted)'} fontSize="12" fontFamily="JetBrains Mono, monospace">
                  {label.length > 28 ? `${label.slice(0, 27)}…` : label}
                </text>
                <text x={depthX + 11} y={y + 40} fill="var(--text-dim)" fontSize="10.5" fontFamily="JetBrains Mono, monospace">
                  {s.source || 'unknown'} • {roleLabel}
                  {row.parentId ? ` • from ${compactLabel(parentLabel)}` : ''}
                  {inferred ? ' • inferred' : ''}
                  {childCount > 0 ? ` • ${childCount} child` : ''}
                  {taskCount > 0 ? ` • ${taskCount} running` : ''}
                  {totalTokens > 0 ? ` • ${fmtCompactNum(totalTokens)} tok` : ''}
                  • {turns.length} turns
                </text>

                <rect
                  x={x1}
                  y={y + 18}
                  width={barW}
                  height={24}
                  rx={7}
                  fill={color}
                  opacity={isSelected ? 0.95 : 0.75}
                  stroke={isSelected ? 'var(--text)' : 'var(--border)'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {thinking && (
                  <rect
                    x={x1}
                    y={y + 18}
                    width={barW}
                    height={24}
                    rx={7}
                    fill="var(--warn)"
                    opacity="0.2"
                  />
                )}
                <text x={x1 + 8} y={y + 33} fill="#f1f1f2" fontSize="11" fontFamily="JetBrains Mono, monospace">
                  {fmtDuration(s.started_at, s.ended_at)}
                </text>
              </g>

              {turns.map((turn, tIdx) => {
                const tx1 = tsToX(turn.started_at || minTs)
                const tx2 = tsToX(turn.ended_at || (turn.started_at || minTs) + span * 0.02)
                const tw = Math.max(4, tx2 - tx1)
                const selected =
                  selectedTurn &&
                  selectedTurn.started_at === turn.started_at &&
                  selectedTurn._tool_count === turn._tool_count
                return (
                  <rect
                    key={`${s.id}-turn-${tIdx}`}
                    x={tx1}
                    y={y + 48}
                    width={tw}
                    height={7}
                    rx={3}
                    fill={selected ? 'var(--accent)' : 'var(--accent-2)'}
                    opacity={selected ? 1 : 0.78}
                    onClick={() => {
                      onSelectSession(s.id)
                      onSelectTurn?.(turn)
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function buildLineageGraph(sessions) {
  const byId = new Map(sessions.map(s => [s.id, s]))
  const children = new Map()
  const directChildrenCount = new Map()
  for (const s of sessions) {
    if (!s.parent_session_id || !byId.has(s.parent_session_id)) continue
    if (!children.has(s.parent_session_id)) children.set(s.parent_session_id, [])
    children.get(s.parent_session_id).push(s)
    directChildrenCount.set(s.parent_session_id, (directChildrenCount.get(s.parent_session_id) ?? 0) + 1)
  }
  for (const arr of children.values()) arr.sort((a, b) => (a.started_at || 0) - (b.started_at || 0))

  const roots = sessions
    .filter(s => !s.parent_session_id || !byId.has(s.parent_session_id))
    .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))

  const rows = []
  const edges = []
  const index = new Map()
  const walk = (s, depth, parentId = null) => {
    const row = rows.length
    rows.push({ session: s, depth, parentId })
    index.set(s.id, { session: s, row, depth })
    for (const c of children.get(s.id) || []) {
      edges.push({ parent: s.id, child: c.id })
      walk(c, depth + 1, s.id)
    }
  }
  for (const r of roots) walk(r, 0, null)
  return { rows, edges, index, directChildrenCount }
}

function fmtDuration(start, end) {
  if (!start) return 'n/a'
  const s = (end ?? Date.now() / 1000) - start
  if (s < 60) return `${s.toFixed(0)}s`
  if (s < 3600) return `${(s / 60).toFixed(1)}m`
  return `${(s / 3600).toFixed(1)}h`
}

function compactLabel(value) {
  if (!value) return '\u2014'
  const text = String(value)
  if (text.length <= 16) return text
  return text.slice(0, 15) + '\u2026'
}

function fmtCompactNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
