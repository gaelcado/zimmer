import { toolColor } from './colors.js'

/**
 * All drawing functions accept an optional offsetX (the left column width).
 * blockW = canvasWidth - offsetX
 * x_on_canvas = offsetX + tsToX(ts, viewStart, viewEnd, blockW)
 */

export function tsToX(ts, viewStart, viewEnd, blockW) {
  if (viewEnd <= viewStart || blockW <= 0) return 0
  return ((ts - viewStart) / (viewEnd - viewStart)) * blockW
}

export function xToTs(x, viewStart, viewEnd, blockW) {
  if (blockW <= 0) return viewStart
  return viewStart + (x / blockW) * (viewEnd - viewStart)
}

// ─── Block clustering ─────────────────────────────────────────────────────────
//
// When zoomed out, individual tool calls are tiny slivers. We merge them into
// visible clusters: a wider bar with color segments + count badge.
// When zoomed in enough that each block is wide, they render individually.

const CLUSTER_GAP_PX = 3   // max px gap between blocks to merge into a cluster
const SINGLE_MIN_W   = 14  // px — blocks narrower than this get clustered

/**
 * Returns an array of visual items: { type: 'single', block } or
 * { type: 'cluster', blocks, startTs, endTs }.
 * Blocks must be sorted by started_at.
 */
export function computeVisualItems(blocks, viewStart, viewEnd, blockW) {
  if (!blocks.length) return []
  const now = Date.now() / 1000
  const items = []
  let cluster = null

  for (const block of blocks) {
    if (block._turn) {
      if (cluster) { items.push(cluster); cluster = null }
      items.push({ type: 'single', block })
      continue
    }
    const rx1 = tsToX(block.started_at, viewStart, viewEnd, blockW)
    const rx2 = tsToX(block.ended_at ?? now, viewStart, viewEnd, blockW)
    const w = rx2 - rx1

    if (w >= SINGLE_MIN_W) {
      // Wide enough to render on its own
      if (cluster) { items.push(cluster); cluster = null }
      items.push({ type: 'single', block })
    } else {
      // Candidate for clustering
      if (cluster) {
        const clusterRx2 = tsToX(cluster.endTs, viewStart, viewEnd, blockW)
        // Merge if this block starts close to the cluster's end
        if (rx1 - clusterRx2 <= CLUSTER_GAP_PX) {
          cluster.blocks.push(block)
          cluster.endTs = Math.max(cluster.endTs, block.ended_at ?? now)
          continue
        }
        items.push(cluster)
      }
      cluster = {
        type: 'cluster',
        blocks: [block],
        startTs: block.started_at,
        endTs: block.ended_at ?? now,
      }
    }
  }
  if (cluster) items.push(cluster)
  return items
}

// ─── Block drawing ───────────────────────────────────────────────────────────

const MIN_VISUAL_W = 22  // px — visual minimum for individual blocks
const MIN_HIT_W    = 22  // px — click target minimum

export function drawBlock(ctx, block, viewStart, viewEnd, blockW, H, isActive, isSelected, yOffset, offsetX) {
  const { tool_name, started_at, ended_at } = block
  const now = Date.now() / 1000
  const end = ended_at ?? now

  const rx1 = tsToX(started_at, viewStart, viewEnd, blockW)
  const rx2 = tsToX(end, viewStart, viewEnd, blockW)
  const rawW = rx2 - rx1
  const minW = block._turn ? 36 : (isActive ? 12 : MIN_VISUAL_W)
  const bw = Math.max(rawW, minW)

  // Clip to blocks area
  if (rx1 > blockW || rx1 + bw < 0) return

  const x1 = offsetX + rx1
  const color = toolColor(tool_name)
  const pad = 6
  const rr = 4

  ctx.save()

  if (isActive) {
    const pulse = 0.5 + 0.4 * Math.sin(Date.now() / 260)
    ctx.shadowBlur = 10
    ctx.shadowColor = color
    ctx.globalAlpha = pulse
  } else {
    ctx.globalAlpha = isSelected ? 1 : 0.82
  }
  if (isSelected) {
    ctx.shadowBlur = 12
    ctx.shadowColor = '#fff'
  }

  ctx.fillStyle = color
  _roundRect(ctx, x1, yOffset + pad, bw, H - pad * 2, rr)
  ctx.fill()

  if (isSelected) {
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    _roundRect(ctx, x1, yOffset + pad, bw, H - pad * 2, rr)
    ctx.stroke()
  }

  // Label inside block — only if wide enough
  const label = block._turn
    ? `turn ×${block._tool_count ?? (Array.isArray(block._subcalls) ? block._subcalls.length : 0)}`
    : tool_name
  if (bw > 60 && label) {
    ctx.globalAlpha = 0.95
    ctx.fillStyle = '#fff'
    ctx.font = '600 11px "JetBrains Mono", monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.save()
    ctx.beginPath()
    ctx.rect(x1 + 5, yOffset, bw - 10, H)
    ctx.clip()
    const shortLabel = label.length > 18 ? label.slice(0, 16) + '…' : label
    ctx.fillText(shortLabel, x1 + 6, yOffset + H / 2)
    ctx.restore()
  }

  ctx.restore()
}

// ─── Cluster drawing ─────────────────────────────────────────────────────────

export function drawCluster(ctx, cluster, viewStart, viewEnd, blockW, H, isSelected, yOffset, offsetX, hasLive = false) {
  const { blocks, startTs, endTs } = cluster
  const now = Date.now() / 1000

  const rx1 = tsToX(startTs, viewStart, viewEnd, blockW)
  const rx2 = tsToX(endTs ?? now, viewStart, viewEnd, blockW)
  const rawW = rx2 - rx1
  const bw = Math.max(rawW, MIN_VISUAL_W * 1.5)

  if (rx1 > blockW || rx1 + bw < 0) return

  const x1 = offsetX + rx1
  const pad = 6
  const rr = 4
  const barH = H - pad * 2

  ctx.save()

  if (hasLive) {
    const pulse = 0.5 + 0.4 * Math.sin(Date.now() / 260)
    ctx.globalAlpha = pulse
    ctx.shadowBlur = 10
    ctx.shadowColor = '#155838'
  } else {
    ctx.globalAlpha = isSelected ? 1 : 0.85
  }

  if (isSelected) {
    ctx.shadowBlur = 12
    ctx.shadowColor = '#fff'
  }

  // Draw stacked color segments for each tool type in the cluster
  const toolCounts = {}
  for (const b of blocks) {
    const name = b.tool_name ?? 'unknown'
    toolCounts[name] = (toolCounts[name] ?? 0) + 1
  }
  const entries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])
  const total = blocks.length

  // Background bar
  ctx.fillStyle = '#1c1c1f'
  _roundRect(ctx, x1, yOffset + pad, bw, barH, rr)
  ctx.fill()

  // Color segments (horizontal stripes)
  ctx.save()
  _roundRect(ctx, x1, yOffset + pad, bw, barH, rr)
  ctx.clip()

  let segY = yOffset + pad
  for (const [toolName, count] of entries) {
    const segH = Math.max(4, (count / total) * barH)
    ctx.fillStyle = toolColor(toolName)
    ctx.globalAlpha = isSelected ? 0.9 : 0.7
    ctx.fillRect(x1, segY, bw, segH)
    segY += segH
  }
  ctx.restore()

  // Border
  ctx.globalAlpha = isSelected ? 1 : 0.6
  ctx.strokeStyle = isSelected ? '#fff' : '#28282c'
  ctx.lineWidth = isSelected ? 2 : 1
  _roundRect(ctx, x1, yOffset + pad, bw, barH, rr)
  ctx.stroke()

  // Count badge
  ctx.globalAlpha = 1
  const badge = `×${blocks.length}`
  ctx.font = '700 11px "JetBrains Mono", monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  const badgeW = ctx.measureText(badge).width + 10
  const badgeH = 18
  const badgeX = x1 + bw / 2 - badgeW / 2
  const badgeY = yOffset + H / 2 - badgeH / 2

  ctx.fillStyle = '#0d0d0f'
  ctx.globalAlpha = 0.85
  _roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 9)
  ctx.fill()

  ctx.globalAlpha = 1
  ctx.fillStyle = '#f1f1f2'
  ctx.fillText(badge, x1 + bw / 2, yOffset + H / 2 + 1)

  ctx.restore()
}

// ─── Time axis — absolute local time (stock-chart style) ────────────────────

const TICK_LEVELS = [
  { interval: 1,    snap: 'second', minPx: 50 },
  { interval: 2,    snap: 'second', minPx: 50 },
  { interval: 5,    snap: 'second', minPx: 50 },
  { interval: 10,   snap: 'second', minPx: 60 },
  { interval: 15,   snap: 'second', minPx: 60 },
  { interval: 30,   snap: 'second', minPx: 60 },
  { interval: 60,    snap: 'minute', minPx: 60 },
  { interval: 120,   snap: 'minute', minPx: 65 },
  { interval: 300,   snap: 'minute', minPx: 65 },
  { interval: 600,   snap: 'minute', minPx: 65 },
  { interval: 900,   snap: 'minute', minPx: 65 },
  { interval: 1800,  snap: 'minute', minPx: 65 },
  { interval: 3600,  snap: 'hour', minPx: 65 },
  { interval: 7200,  snap: 'hour', minPx: 65 },
  { interval: 14400, snap: 'hour', minPx: 65 },
  { interval: 28800, snap: 'hour', minPx: 65 },
  { interval: 43200, snap: 'hour', minPx: 65 },
  { interval: 86400, snap: 'day',  minPx: 80 },
]

function _pickTickLevel(span, blockW) {
  for (const level of TICK_LEVELS) {
    const pxPerTick = (level.interval / span) * blockW
    if (pxPerTick >= level.minPx) return level
  }
  return TICK_LEVELS[TICK_LEVELS.length - 1]
}

function _fmtAbsTime(tsSec, snap) {
  const d = new Date(tsSec * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  if (snap === 'second') return `${hh}:${mm}:${ss}`
  if (snap === 'minute') return `${hh}:${mm}`
  if (snap === 'hour')   return `${hh}:00`
  if (snap === 'day') {
    const mon = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${mon}/${day}`
  }
  return `${hh}:${mm}`
}

export function drawTimeTicks(ctx, viewStart, viewEnd, W, H, offsetX = 0) {
  const blockW = W - offsetX
  const span = viewEnd - viewStart
  if (span <= 0 || blockW <= 0) return

  // Background
  ctx.fillStyle = '#0d0d0f'
  ctx.fillRect(offsetX, 0, blockW, H)

  const level = _pickTickLevel(span, blockW)
  const { interval, snap } = level
  const firstTick = Math.ceil(viewStart / interval) * interval

  // Grid lines (subtle)
  ctx.strokeStyle = '#1c1c1f'
  ctx.lineWidth = 1
  for (let t = firstTick; t <= viewEnd; t += interval) {
    const x = offsetX + tsToX(t, viewStart, viewEnd, blockW)
    if (x < offsetX || x > W) continue
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }

  // Tick marks
  ctx.strokeStyle = '#28282c'
  ctx.lineWidth = 1
  for (let t = firstTick; t <= viewEnd; t += interval) {
    const x = offsetX + tsToX(t, viewStart, viewEnd, blockW)
    if (x < offsetX || x > W) continue
    ctx.beginPath()
    ctx.moveTo(x, H - 6)
    ctx.lineTo(x, H)
    ctx.stroke()
  }

  // Labels
  ctx.fillStyle = '#515158'
  ctx.font = '11px "JetBrains Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = firstTick; t <= viewEnd; t += interval) {
    const x = offsetX + tsToX(t, viewStart, viewEnd, blockW)
    if (x < offsetX + 24 || x > W - 24) continue
    ctx.fillText(_fmtAbsTime(t, snap), x, 6)
  }

  // "Now" indicator
  const now = Date.now() / 1000
  if (now >= viewStart && now <= viewEnd) {
    const nx = offsetX + tsToX(now, viewStart, viewEnd, blockW)
    ctx.fillStyle = '#155838'
    ctx.beginPath()
    ctx.moveTo(nx, H)
    ctx.lineTo(nx - 4, H - 5)
    ctx.lineTo(nx + 4, H - 5)
    ctx.closePath()
    ctx.fill()
  }

  // Bottom border
  ctx.fillStyle = '#28282c'
  ctx.fillRect(offsetX, H - 1, blockW, 1)
}

/**
 * Draw the "now" line through the entire blocks area height.
 */
export function drawNowLine(ctx, viewStart, viewEnd, blockW, totalH, offsetX) {
  const now = Date.now() / 1000
  if (now < viewStart || now > viewEnd) return
  const x = offsetX + tsToX(now, viewStart, viewEnd, blockW)
  ctx.save()
  ctx.strokeStyle = 'rgba(21,88,56,0.3)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, totalH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Draw vertical grid lines through the blocks area.
 */
export function drawGridLines(ctx, viewStart, viewEnd, W, totalH, offsetX) {
  const blockW = W - offsetX
  const span = viewEnd - viewStart
  if (span <= 0 || blockW <= 0) return

  const level = _pickTickLevel(span, blockW)
  const firstTick = Math.ceil(viewStart / level.interval) * level.interval

  ctx.save()
  ctx.strokeStyle = '#1c1c1f'
  ctx.lineWidth = 1
  for (let t = firstTick; t <= viewEnd; t += level.interval) {
    const x = offsetX + tsToX(t, viewStart, viewEnd, blockW)
    if (x < offsetX || x > W) continue
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, totalH)
    ctx.stroke()
  }
  ctx.restore()
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

/**
 * Hit-test against visual items (singles + clusters).
 * Returns { type: 'single', block } or { type: 'cluster', cluster } or null.
 */
export function hitTestVisualItems(items, clickX, viewStart, viewEnd, blockW) {
  const now = Date.now() / 1000
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'single') {
      const b = item.block
      const rx1 = tsToX(b.started_at, viewStart, viewEnd, blockW)
      const rx2 = tsToX(b.ended_at ?? now, viewStart, viewEnd, blockW)
      const bw = Math.max(rx2 - rx1, MIN_HIT_W)
      const hitStart = rx2 - rx1 < MIN_HIT_W ? rx1 - (MIN_HIT_W - (rx2 - rx1)) / 2 : rx1
      if (clickX >= hitStart && clickX <= hitStart + bw) return { type: 'single', block: b }
    } else {
      const { startTs, endTs } = item
      const rx1 = tsToX(startTs, viewStart, viewEnd, blockW)
      const rx2 = tsToX(endTs, viewStart, viewEnd, blockW)
      const bw = Math.max(rx2 - rx1, MIN_VISUAL_W * 1.5)
      const hitStart = rx1
      if (clickX >= hitStart && clickX <= hitStart + bw) return { type: 'cluster', cluster: item }
    }
  }
  return null
}

// Keep old hitTestBlocks for backward compat
export function hitTestBlocks(blocks, clickX, viewStart, viewEnd, blockW) {
  const now = Date.now() / 1000
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    const rx1 = tsToX(b.started_at, viewStart, viewEnd, blockW)
    const rx2 = tsToX(b.ended_at ?? now, viewStart, viewEnd, blockW)
    const bw  = Math.max(rx2 - rx1, MIN_HIT_W)
    const hitStart = rx2 - rx1 < MIN_HIT_W ? rx1 - (MIN_HIT_W - (rx2 - rx1)) / 2 : rx1
    if (clickX >= hitStart && clickX <= hitStart + bw) return b
  }
  return null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}
