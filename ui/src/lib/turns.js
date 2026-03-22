export function buildTurnGroups(dbBlocks = [], liveTasks = new Map()) {
  const byTurn = new Map()
  const openDbSubcalls = []

  for (const b of dbBlocks) {
    const key = b.turn_id != null ? `db:${b.turn_id}` : `db_ts:${Math.round((b.started_at ?? 0) * 10)}`
    const existing = byTurn.get(key)
    if (!existing) {
      byTurn.set(key, {
        tool_name: 'turn',
        started_at: b.started_at,
        ended_at: b.ended_at ?? null,
        _turn: true,
        _turn_id: b.turn_id ?? null,
        _tool_count: 1,
        _subcalls: [b],
      })
      if (b.ended_at == null) openDbSubcalls.push(b)
      continue
    }
    existing.started_at = Math.min(existing.started_at, b.started_at)
    if (b.ended_at == null || existing.ended_at == null) {
      existing.ended_at = null
    } else {
      existing.ended_at = Math.max(existing.ended_at, b.ended_at)
    }
    existing._tool_count += 1
    existing._subcalls.push(b)
    if (b.ended_at == null) openDbSubcalls.push(b)
  }

  const turns = [...byTurn.values()].sort((a, b) => a.started_at - b.started_at)

  if (liveTasks && liveTasks.size > 0) {
    const liveSubcalls = []
    for (const task of liveTasks.values()) {
      const alreadyInDb = openDbSubcalls.some(b =>
        b.tool_name === task.tool && Math.abs((b.started_at ?? 0) - task.started_at) < 0.15
      )
      if (alreadyInDb) continue
      liveSubcalls.push({
        tool_name: task.tool,
        started_at: task.started_at,
        ended_at: null,
        args: task.args,
        result_preview: '',
        _live: true,
        _callId: task.call_id,
      })
    }
    if (liveSubcalls.length > 0) {
      const liveStart = Math.min(...liveSubcalls.map(t => t.started_at))
      turns.push({
        tool_name: 'turn',
        started_at: liveStart,
        ended_at: null,
        _turn: true,
        _turn_id: 'live',
        _tool_count: liveSubcalls.length,
        _subcalls: liveSubcalls,
        _live: true,
      })
    }
  }

  return turns.sort((a, b) => a.started_at - b.started_at)
}

