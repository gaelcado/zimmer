import { useRef, useEffect, useCallback } from 'react'
import { drawBlock, drawCluster, drawTimeTicks, drawNowLine, drawGridLines, computeVisualItems, hitTestVisualItems } from '../lib/timeline.js'
import Kbd from './Kbd.jsx'

const LABEL_W  = 230  // left column: session labels
const TICK_H   = 36   // sticky tick header height
const ROW_H    = 68   // height of each session row
const MIN_SPAN = 0.5  // minimum zoom span in seconds
const MAX_SPAN = 86400 * 7

const DRAG_THRESHOLD = 4

// ─────────────────────────────────────────────────────────────────────────────

export default function TimelineCanvas({
  sessions,
  sessionBlocks,
  activeTasks,
  sessionActiveTasks,
  llmActive,
  selectedSessionId,
  selectedBlock,
  onSelectSession,
  onSelectBlock,
}) {
  const containerRef = useRef()
  const tickRef      = useRef()
  const blocksRef    = useRef()
  const viewRef      = useRef({ start: 0, end: 60, initialized: false })
  const rafRef       = useRef()
  const lastSelectedRef = useRef(null)

  // Interaction state
  const interRef = useRef({
    pointerDown: false,
    startX: 0,
    startY: 0,
    totalDist: 0,
    didDrag: false,
    startView: null,
    pointerId: null,
  })

  // ── View fitting ────────────────────────────────────────────────────────────

  const computeViewForSession = useCallback((session) => {
    const now = Date.now() / 1000
    const blocks = sessionBlocks[session.id] ?? []
    if (blocks.length > 0) {
      const minT = Math.min(...blocks.map(b => b.started_at))
      const maxT = Math.max(...blocks.map(b => b.ended_at ?? now), now)
      const span = Math.max(maxT - minT, 2)
      return { start: minT - span * 0.08, end: maxT + span * 0.15 }
    }
    const span = Math.max((session.ended_at ?? now) - session.started_at, 5)
    return { start: session.started_at - span * 0.05, end: (session.ended_at ?? now) + span * 0.1 }
  }, [sessionBlocks])

  const fitAll = useCallback(() => {
    const now = Date.now() / 1000
    const allBlocks = sessions.flatMap(s => sessionBlocks[s.id] ?? [])
    if (allBlocks.length > 0) {
      const minT = Math.min(...allBlocks.map(b => b.started_at))
      const maxT = Math.max(...allBlocks.map(b => b.ended_at ?? now), now)
      const pad = Math.max((maxT - minT) * 0.04, 2)
      viewRef.current = { start: minT - pad, end: maxT + pad, initialized: true }
      return
    }
    const starts = sessions.map(s => s.started_at).filter(Boolean)
    if (!starts.length) { viewRef.current = { start: now - 60, end: now + 10, initialized: true }; return }
    const ends = sessions.map(s => s.ended_at ?? now)
    const minT = Math.min(...starts)
    const maxT = Math.max(...ends, now)
    const pad = Math.max((maxT - minT) * 0.04, 2)
    viewRef.current = { start: minT - pad, end: maxT + pad, initialized: true }
  }, [sessions, sessionBlocks])

  useEffect(() => {
    if (!viewRef.current.initialized && sessions.length > 0) fitAll()
  }, [sessions.length, fitAll])

  useEffect(() => {
    if (!selectedSessionId) return
    if (lastSelectedRef.current === selectedSessionId) return
    lastSelectedRef.current = selectedSessionId
    const session = sessions.find(s => s.id === selectedSessionId)
    if (!session) return
    const v = computeViewForSession(session)
    viewRef.current = { ...v, initialized: true }
  }, [selectedSessionId, computeViewForSession, sessions])

  // ── Drawing ─────────────────────────────────────────────────────────────────

  const drawFrame = useCallback(() => {
    const container = containerRef.current
    const blockCanvas = blocksRef.current
    const tickCanvas  = tickRef.current
    if (!blockCanvas) return

    const dpr = window.devicePixelRatio || 1
    const W = blockCanvas.clientWidth
    const totalH = Math.max(sessions.length * ROW_H, 100)
    const scrollTop = container?.scrollTop ?? 0
    const containerH = container?.clientHeight ?? 600
    const blockW = W - LABEL_W
    const { start, end } = viewRef.current

    // ── Tick header ──
    if (tickCanvas) {
      const tH = TICK_H
      if (tickCanvas.width !== W * dpr || tickCanvas.height !== tH * dpr) {
        tickCanvas.width = W * dpr
        tickCanvas.height = tH * dpr
      }
      const tc = tickCanvas.getContext('2d')
      tc.setTransform(dpr, 0, 0, dpr, 0, 0)
      tc.clearRect(0, 0, W, tH)

      tc.fillStyle = '#0d0d0f'
      tc.fillRect(0, 0, LABEL_W, tH)
      tc.fillStyle = '#515158'
      tc.font = '600 11px "JetBrains Mono", monospace'
      tc.textAlign = 'center'
      tc.textBaseline = 'middle'
      tc.fillText('SESSION', LABEL_W / 2, tH / 2)

      tc.fillStyle = '#28282c'
      tc.fillRect(LABEL_W, 0, 1, tH)

      drawTimeTicks(tc, start, end, W, tH, LABEL_W)
    }

    // ── Blocks canvas ──
    if (blockCanvas.width !== W * dpr || blockCanvas.height !== totalH * dpr) {
      blockCanvas.width = W * dpr
      blockCanvas.height = totalH * dpr
    }
    const ctx = blockCanvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const firstRow = Math.max(0, Math.floor((scrollTop - ROW_H) / ROW_H))
    const lastRow  = Math.min(sessions.length - 1, Math.ceil((scrollTop + containerH + ROW_H) / ROW_H))
    ctx.clearRect(0, firstRow * ROW_H, W, (lastRow - firstRow + 1) * ROW_H)

    // Grid lines (behind everything)
    drawGridLines(ctx, start, end, W, totalH, LABEL_W)
    drawNowLine(ctx, start, end, blockW, totalH, LABEL_W)

    for (let i = firstRow; i <= lastRow; i++) {
      const session = sessions[i]
      const y = i * ROW_H
      const isSelected = session.id === selectedSessionId
      const isActive   = !session.ended_at
      const isThinking = llmActive?.has(session.id)

      // Row background
      ctx.fillStyle = i % 2 === 0 ? '#111113' : '#0d0d0f'
      ctx.fillRect(0, y, W, ROW_H)
      if (isSelected) {
        ctx.fillStyle = 'rgba(21,88,56,0.09)'
        ctx.fillRect(0, y, W, ROW_H)
      }

      if (isThinking) {
        const pulse = 0.04 + 0.03 * Math.sin(Date.now() / 600)
        ctx.fillStyle = `rgba(21,88,56,${pulse})`
        ctx.fillRect(LABEL_W + 1, y, blockW, ROW_H)
      }

      ctx.fillStyle = '#1c1c1f'
      ctx.fillRect(0, y + ROW_H - 1, W, 1)

      _drawLabel(ctx, session, y, ROW_H, LABEL_W, isSelected, isActive, isThinking)

      ctx.fillStyle = '#28282c'
      ctx.fillRect(LABEL_W, y, 1, ROW_H)

      const allBlocks = _buildSessionTurnBlocks(
        sessionBlocks[session.id] ?? [],
        sessionActiveTasks?.get(session.id),
      )

      // Compute visual items (clustered or single) from merged blocks
      const visItems = computeVisualItems(allBlocks, start, end, blockW)

      for (const item of visItems) {
        if (item.type === 'single') {
          const isLive = !!item.block._live
          drawBlock(ctx, item.block, start, end, blockW, ROW_H, isLive, item.block === selectedBlock, y, LABEL_W)
        } else {
          const hasLive = item.blocks.some(b => b._live)
          const clusterSelected = selectedBlock && item.blocks.includes(selectedBlock)
          drawCluster(ctx, item, start, end, blockW, ROW_H, clusterSelected, y, LABEL_W, hasLive)
        }
      }
    }

    if (sessions.length === 0) {
      ctx.fillStyle = '#515158'
      ctx.font = '13px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No sessions — start Hermes to see activity', W / 2, 100)
    }
  }, [sessions, sessionBlocks, activeTasks, sessionActiveTasks, llmActive, selectedSessionId, selectedBlock])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.closest('.xterm')) return
      const { start, end } = viewRef.current
      const span = end - start
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const dt = span * 0.15
        viewRef.current = { ...viewRef.current, start: start - dt, end: end - dt }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const dt = span * 0.15
        viewRef.current = { ...viewRef.current, start: start + dt, end: end + dt }
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        _zoomView(viewRef, 0.5, 0.85, MIN_SPAN, MAX_SPAN)
      } else if (e.key === '-') {
        e.preventDefault()
        _zoomView(viewRef, 0.5, 1.18, MIN_SPAN, MAX_SPAN)
      } else if (e.key === '0' || e.key === 'Home') {
        e.preventDefault()
        fitAll()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = sessions.findIndex(s => s.id === selectedSessionId)
        const newIdx = e.key === 'ArrowUp'
          ? Math.max(0, idx - 1)
          : Math.min(sessions.length - 1, idx + 1)
        if (newIdx !== idx && sessions[newIdx]) {
          onSelectSession(sessions[newIdx].id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitAll, sessions, selectedSessionId, onSelectSession])

  // ── RAF loop ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => { drawFrame(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [drawFrame])

  // ── Wheel zoom ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = blocksRef.current
    if (!canvas) return

    const handler = (e) => {
      const { start, end } = viewRef.current
      const span = end - start
      const blockW = canvas.clientWidth - LABEL_W
      const rect = canvas.getBoundingClientRect()
      const rx = e.clientX - rect.left - LABEL_W

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const rawDelta = Math.max(-60, Math.min(60, e.deltaY))
        const factor = 1 + rawDelta * 0.003

        const frac = Math.max(0, Math.min(1, rx / blockW))
        const newSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span * factor))
        const pivot = start + frac * span
        viewRef.current = {
          ...viewRef.current,
          start: pivot - frac * newSpan,
          end:   pivot + (1 - frac) * newSpan,
        }
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5) {
        e.preventDefault()
        const dt = (e.deltaX / blockW) * span * 0.4
        viewRef.current = { ...viewRef.current, start: start + dt, end: end + dt }
      }
    }

    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  // ── Pointer events (unified drag + click) ─────────────────────────────────

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return
    const canvas = blocksRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    interRef.current = {
      pointerDown: true,
      startX: e.clientX,
      startY: e.clientY,
      totalDist: 0,
      didDrag: false,
      startView: { ...viewRef.current },
      pointerId: e.pointerId,
    }
  }, [])

  const onPointerMove = useCallback((e) => {
    const s = interRef.current
    if (!s.pointerDown) return

    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    s.totalDist = Math.max(s.totalDist, Math.sqrt(dx * dx + dy * dy))

    if (s.totalDist > DRAG_THRESHOLD) {
      s.didDrag = true
      const blockW = (blocksRef.current?.clientWidth ?? 0) - LABEL_W
      if (blockW > 0 && s.startView) {
        const dt = -(dx / blockW) * (s.startView.end - s.startView.start)
        viewRef.current = {
          ...viewRef.current,
          start: s.startView.start + dt,
          end:   s.startView.end + dt,
        }
      }
    }
  }, [])

  const onPointerUp = useCallback((e) => {
    const s = interRef.current
    if (!s.pointerDown) return

    const canvas = blocksRef.current
    if (canvas && s.pointerId != null) {
      try { canvas.releasePointerCapture(s.pointerId) } catch (_) {}
    }

    if (!s.didDrag && s.totalDist <= DRAG_THRESHOLD) {
      _handleClick(e, canvas, sessions, sessionBlocks, sessionActiveTasks, viewRef, containerRef,
                   onSelectSession, onSelectBlock, lastSelectedRef)
    }

    s.pointerDown = false
    s.didDrag = false
  }, [sessions, sessionBlocks, sessionActiveTasks, onSelectSession, onSelectBlock])

  const totalH = Math.max(sessions.length * ROW_H, 100)

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-w-0 bg-[#0d0d0f]">
      <canvas
        ref={tickRef}
        style={{ display: 'block', width: '100%', height: TICK_H, flexShrink: 0 }}
      />

      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <canvas
          ref={blocksRef}
          style={{ display: 'block', width: '100%', height: totalH, cursor: 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>

      <div className="flex-none flex items-center justify-between gap-3 px-4 h-8 border-t border-[#28282c] text-[11px] text-[#515158] select-none">
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
          <span className="whitespace-nowrap">drag to pan</span>
          <span style={{ color: '#28282c' }}>|</span>
          <Kbd keys={['Ctrl', 'Scroll']} size="xs" />
          <span className="whitespace-nowrap">zoom</span>
          <span style={{ color: '#28282c' }}>|</span>
          <Kbd keys="←" size="xs" />
          <Kbd keys="→" size="xs" />
          <Kbd keys="↑" size="xs" />
          <Kbd keys="↓" size="xs" />
          <Kbd keys="+" size="xs" />
          <Kbd keys="-" size="xs" />
          <span className="whitespace-nowrap">navigate</span>
        </div>
        <button
          onClick={fitAll}
          className="text-[#515158] hover:text-[#9b9ba2] transition-colors px-2 py-0.5 rounded hover:bg-[#1c1c1f] flex items-center gap-1.5 whitespace-nowrap"
        >
          <Kbd keys="0" size="xs" />
          fit all
        </button>
      </div>
    </div>
  )
}

// ── Click handler ────────────────────────────────────────────────────────────

function _handleClick(e, canvas, sessions, sessionBlocks, sessionActiveTasks, viewRef, containerRef,
                      onSelectSession, onSelectBlock, lastSelectedRef) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const clickX = e.clientX - rect.left
  const clickY = e.clientY - rect.top + (containerRef.current?.scrollTop ?? 0)
  const rowIdx = Math.floor(clickY / ROW_H)
  if (rowIdx < 0 || rowIdx >= sessions.length) return
  const session = sessions[rowIdx]

  if (clickX < LABEL_W) {
    onSelectSession(session.id)
    onSelectBlock(null)
    return
  }

  const rx = clickX - LABEL_W
  const blockW = canvas.clientWidth - LABEL_W
  const { start, end } = viewRef.current

  const allBlocks = _buildSessionTurnBlocks(
    sessionBlocks[session.id] ?? [],
    sessionActiveTasks?.get(session.id),
  )

  const visItems = computeVisualItems(allBlocks, start, end, blockW)
  const hit = hitTestVisualItems(visItems, rx, start, end, blockW)

  lastSelectedRef.current = session.id
  onSelectSession(session.id)

  if (hit?.type === 'cluster') {
    const cluster = hit.cluster
    const span = cluster.endTs - cluster.startTs
    const pad = Math.max(span * 0.2, 0.5)
    viewRef.current = {
      start: cluster.startTs - pad,
      end: cluster.endTs + pad,
      initialized: true,
    }
    onSelectBlock(null)
  } else if (hit?.type === 'single') {
    onSelectBlock(hit.block)
  } else {
    onSelectBlock(null)
  }
}

// ── Zoom helper ──────────────────────────────────────────────────────────────

function _zoomView(viewRef, pivotFrac, factor, minSpan, maxSpan) {
  const { start, end } = viewRef.current
  const span = end - start
  const newSpan = Math.max(minSpan, Math.min(maxSpan, span * factor))
  const pivot = start + pivotFrac * span
  viewRef.current = {
    ...viewRef.current,
    start: pivot - pivotFrac * newSpan,
    end:   pivot + (1 - pivotFrac) * newSpan,
  }
}

// ─── Canvas label drawing ────────────────────────────────────────────────────

function _drawLabel(ctx, session, y, H, LABEL_W, isSelected, isActive, isThinking) {
  const DOT_X = 14
  const TEXT_X = 28
  const maxW = LABEL_W - TEXT_X - 8

  // Status dot
  ctx.beginPath()
  ctx.arc(DOT_X, y + H / 2, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = isActive ? '#22c55e' : '#28282c'
  ctx.fill()

  // Thinking ring
  if (isThinking) {
    ctx.beginPath()
    ctx.arc(DOT_X, y + H / 2, 7, 0, Math.PI * 2)
    ctx.strokeStyle = '#155838'
    ctx.lineWidth = 1.5
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 400))
    ctx.globalAlpha = pulse
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(TEXT_X, y + 3, maxW, H - 6)
  ctx.clip()

  const rawTitle = session.title
  const rawId = session.id ?? '—'
  const displayName = rawTitle
    ? (rawTitle.length > 22 ? rawTitle.slice(0, 21) + '…' : rawTitle)
    : (rawId.length > 16 ? '…' + rawId.slice(-12) : rawId)

  ctx.font = `${isSelected ? '700' : '500'} 13px "JetBrains Mono", monospace`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = isSelected ? '#f1f1f2' : '#9b9ba2'
  ctx.fillText(displayName, TEXT_X, y + H * 0.44)

  const model = _fmtModel(session.model)
  const source = session.source ? ` · ${session.source}` : ''
  const totalTokens = (session.input_tokens ?? 0) + (session.output_tokens ?? 0)
  const tokenSuffix = totalTokens > 0 ? ` · ${_fmtCompactNum(totalTokens)} tok` : ''
  ctx.font = '11px "JetBrains Mono", monospace'
  ctx.fillStyle = isSelected ? '#71717a' : '#515158'
  ctx.fillText(model + source + tokenSuffix, TEXT_X, y + H * 0.72)

  ctx.restore()
}

function _fmtModel(model) {
  if (!model) return '—'
  const name = model.includes('/') ? model.split('/').pop() : model.replace('claude-', '')
  return name.length > 16 ? name.slice(0, 15) + '…' : name
}

function _fmtCompactNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function _buildSessionTurnBlocks(dbBlocks, liveTasks) {
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

  const turnBlocks = [...byTurn.values()].sort((a, b) => a.started_at - b.started_at)

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
      turnBlocks.push({
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

  return turnBlocks.sort((a, b) => a.started_at - b.started_at)
}
