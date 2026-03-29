/**
 * Canvas-based timeline component for a single session's tool call blocks.
 *
 * Props:
 *   blocks      — array of { tool_name, started_at, ended_at }
 *   activeTasks — Map of live in-flight tasks
 *   sessionStartAt — session start Unix timestamp (seconds)
 *   onSelectBlock — callback(block)
 *   selectedBlock — currently selected block
 *   rowHeight — px (default 32)
 */

import { useRef, useEffect, useCallback } from 'react'
import { drawBlock, drawTimeTicks, hitTestBlock } from '../lib/timeline.js'

const TICK_HEIGHT = 20
const MIN_SPAN_S = 2

export default function Timeline({
  blocks = [],
  activeTasks = new Map(),
  sessionStartAt,
  onSelectBlock,
  selectedBlock,
  rowHeight = 32,
  viewStart: externalViewStart,
  viewEnd: externalViewEnd,
  onViewChange,
}) {
  const canvasRef = useRef(null)
  const stateRef = useRef({
    viewStart: externalViewStart ?? (sessionStartAt || Date.now() / 1000 - 30),
    viewEnd: externalViewEnd ?? (sessionStartAt ? sessionStartAt + 60 : Date.now() / 1000 + 5),
    dragging: false,
    dragStartX: 0,
    dragStartView: null,
    rafId: null,
  })

  // Update view from external props
  useEffect(() => {
    if (externalViewStart != null) stateRef.current.viewStart = externalViewStart
    if (externalViewEnd != null) stateRef.current.viewEnd = externalViewEnd
  }, [externalViewStart, externalViewEnd])

  // Auto-fit view to blocks + active tasks
  useEffect(() => {
    const allBlocks = [
      ...blocks,
      ...[...activeTasks.values()].map(t => ({ started_at: t.started_at, ended_at: null, tool_name: t.tool })),
    ]
    if (allBlocks.length === 0) return
    const minT = Math.min(...allBlocks.map(b => b.started_at))
    const now = Date.now() / 1000
    const maxT = Math.max(...allBlocks.map(b => b.ended_at || now), now)
    const padding = (maxT - minT) * 0.05 || 2
    stateRef.current.viewStart = minT - padding
    stateRef.current.viewEnd = maxT + padding
  }, [blocks.length, activeTasks.size]) // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { viewStart, viewEnd } = stateRef.current
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth
    const H = canvas.clientHeight
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#0d0d0f'
    ctx.fillRect(0, 0, W, H)

    // Time ticks
    drawTimeTicks(ctx, viewStart, viewEnd, W, TICK_HEIGHT)

    const blockH = H - TICK_HEIGHT
    const yOff = TICK_HEIGHT

    // DB blocks
    for (const block of blocks) {
      const isSel = selectedBlock && block === selectedBlock
      drawBlock(ctx, block, viewStart, viewEnd, W, blockH, false, isSel, yOff)
    }

    // Live active tasks
    for (const task of activeTasks.values()) {
      const liveBlock = { tool_name: task.tool, started_at: task.started_at, ended_at: null }
      const isSel = selectedBlock && selectedBlock === liveBlock
      drawBlock(ctx, liveBlock, viewStart, viewEnd, W, blockH, true, isSel, yOff)
    }

    stateRef.current.rafId = requestAnimationFrame(draw)
  }, [blocks, activeTasks, selectedBlock])

  useEffect(() => {
    stateRef.current.rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(stateRef.current.rafId)
  }, [draw])

  // ResizeObserver for retina
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => { /* RAF loop handles resize */ })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Wheel zoom
  const onWheel = useCallback((e) => {
    e.preventDefault()
    const { viewStart, viewEnd } = stateRef.current
    const span = viewEnd - viewStart
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    const newSpan = Math.max(MIN_SPAN_S, span * factor)
    const rect = canvasRef.current.getBoundingClientRect()
    const pivotFrac = (e.clientX - rect.left) / rect.width
    const pivotTs = viewStart + pivotFrac * span
    stateRef.current.viewStart = pivotTs - pivotFrac * newSpan
    stateRef.current.viewEnd = pivotTs + (1 - pivotFrac) * newSpan
    onViewChange?.(stateRef.current.viewStart, stateRef.current.viewEnd)
  }, [onViewChange])

  // Mouse drag pan
  const onMouseDown = useCallback((e) => {
    stateRef.current.dragging = true
    stateRef.current.dragStartX = e.clientX
    stateRef.current.dragStartView = { start: stateRef.current.viewStart, end: stateRef.current.viewEnd }
  }, [])

  const onMouseMove = useCallback((e) => {
    const s = stateRef.current
    if (!s.dragging) return
    const canvas = canvasRef.current
    const W = canvas.clientWidth
    const span = s.dragStartView.end - s.dragStartView.start
    const dx = e.clientX - s.dragStartX
    const dt = -(dx / W) * span
    s.viewStart = s.dragStartView.start + dt
    s.viewEnd = s.dragStartView.end + dt
    onViewChange?.(s.viewStart, s.viewEnd)
  }, [onViewChange])

  const onMouseUp = useCallback(() => {
    stateRef.current.dragging = false
  }, [])

  // Click hit-test
  const onClick = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    if (clickY < TICK_HEIGHT) return
    const { viewStart, viewEnd } = stateRef.current
    const W = canvas.clientWidth
    const hit = hitTestBlock(blocks, clickX, viewStart, viewEnd, W)
    onSelectBlock?.(hit)
  }, [blocks, onSelectBlock])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onClick={onClick}
    />
  )
}
