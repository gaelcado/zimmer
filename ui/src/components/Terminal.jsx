import { useEffect, useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function Terminal({ onClose }) {
  const containerRef = useRef()
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)

  useEffect(() => {
    const host = containerRef.current?.closest('.app-root') || document.documentElement
    const accent = getComputedStyle(host).getPropertyValue('--accent').trim() || '#155838'
    let disposed = false
    let reconnectDelay = 800
    const term = new XTerm({
      theme: {
        background:       '#0d0d0f',
        foreground:       '#e4e4e7',
        cursor:           accent,
        cursorAccent:     '#0d0d0f',
        selectionBackground: hexToRgba(accent, 0.25),
        black:            '#141416', brightBlack:   '#515158',
        red:              '#f38ba8', brightRed:     '#f38ba8',
        green:            '#a6e3a1', brightGreen:   '#a6e3a1',
        yellow:           '#f9e2af', brightYellow:  '#f9e2af',
        blue:             '#89b4fa', brightBlue:    '#89b4fa',
        magenta:          '#cba6f7', brightMagenta: '#cba6f7',
        cyan:             '#89dceb', brightCyan:    '#89dceb',
        white:            '#e4e4e7', brightWhite:   '#ffffff',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    const sendResize = () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const { cols, rows } = term
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }

    const onDataDisposable = term.onData(data => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
    })
    const onResizeDisposable = term.onResize(sendResize)

    const connect = () => {
      if (disposed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/terminal`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        reconnectDelay = 800
        sendResize()
      }

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(e.data))
        } else if (typeof e.data === 'string') {
          term.write(e.data)
        }
      }

      ws.onerror = () => term.writeln('\r\n\x1b[31m[connection error]\x1b[0m')
      ws.onclose = () => {
        if (disposed) return
        term.writeln('\r\n\x1b[2m[disconnected — reconnecting…]\x1b[0m')
        reconnectTimerRef.current = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 8000)
      }
    }

    // Defer initial fit/connect to let layout settle
    requestAnimationFrame(() => {
      fitAddon.fit()
      connect()
    })

    let fitRaf = null
    const ro = new ResizeObserver(() => {
      if (fitRaf) cancelAnimationFrame(fitRaf)
      fitRaf = requestAnimationFrame(() => {
        fitAddon.fit()
        sendResize()
      })
    })
    ro.observe(containerRef.current)

    return () => {
      disposed = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (fitRaf) cancelAnimationFrame(fitRaf)
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      wsRef.current?.close()
      wsRef.current = null
      term.dispose()
      ro.disconnect()
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f]">
      <div className="flex-none flex items-center justify-between px-3 h-7 border-b border-[#28282c] select-none">
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>terminal</span>
        <button
          onClick={onClose}
          className="flex items-center hover:opacity-80"
          style={{ color: 'var(--text-dim)' }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} color="currentColor" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(21,88,56,${alpha})`
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
