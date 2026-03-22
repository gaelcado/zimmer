export default function TurnGroupsPanel({ turns, selectedTurn, onSelectTurn }) {
  if (!turns || turns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[12px]" style={{ color: 'var(--text-dim)' }}>
        No tool turns yet
      </div>
    )
  }

  return (
    <section className="h-full overflow-auto p-2 space-y-1" style={{ background: 'var(--bg-elev)' }} role="listbox" aria-label="Tool turns">
      {turns.map((turn, idx) => {
        const isSelected = selectedTurn && selectedTurn.started_at === turn.started_at && selectedTurn._tool_count === turn._tool_count
        const subcalls = turn._subcalls || []
        const dur = fmtTurnDur(turn)
        const tools = [...new Set(subcalls.map(t => t.tool_name).filter(Boolean))]

        return (
          <button
            key={`${turn._turn_id ?? 'turn'}-${turn.started_at}-${idx}`}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelectTurn(turn)}
            className="w-full text-left rounded-lg border px-2.5 py-2 transition-colors"
            style={{
              borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
              background: isSelected
                ? 'color-mix(in oklab, var(--accent) 12%, var(--panel) 88%)'
                : 'var(--panel)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] truncate" style={{ color: isSelected ? 'var(--text)' : 'var(--text-muted)' }}>
                {tools.join(' \u00B7 ') || 'unknown'}
                <span style={{ color: 'var(--text-dim)' }}> {' ×'}{turn._tool_count || 0}</span>
              </span>
              <span className="text-[10px] flex-none" style={{ color: turn.ended_at ? 'var(--text-dim)' : 'var(--ok)' }}>
                {dur}
              </span>
            </div>
            {subcalls.length > 1 && <TurnRibbon subcalls={subcalls} />}
          </button>
        )
      })}
    </section>
  )
}

function TurnRibbon({ subcalls }) {
  if (!subcalls.length) return null
  const first = Math.min(...subcalls.map(s => s.started_at || 0))
  const last = Math.max(...subcalls.map(s => s.ended_at || s.started_at || 0), first + 0.01)
  const span = Math.max(0.01, last - first)

  return (
    <div className="mt-1.5 rounded overflow-hidden relative" style={{ height: 6, background: 'var(--bg-elev-2)' }}>
      {subcalls.map((s, i) => {
        const left = ((s.started_at - first) / span) * 100
        const end = s.ended_at || (s.started_at + span * 0.05)
        const width = Math.max(2.5, ((end - s.started_at) / span) * 100)
        const hue = (hashCode(s.tool_name || 'tool') % 240) + 80
        return (
          <div
            key={`${s.tool_name || 'tool'}-${s.started_at}-${i}`}
            className="absolute top-0 h-full rounded-sm"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: `hsl(${hue} 70% 55%)`,
              opacity: s.ended_at ? 0.8 : 1,
            }}
          />
        )
      })}
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
