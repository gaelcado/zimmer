import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import Kbd from './Kbd.jsx'

export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c => `${c.label} ${c.hint || ''}`.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[activeIdx]
        if (cmd) {
          cmd.run()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIdx, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ background: 'rgba(13, 13, 15, 0.65)' }}
        >
          <motion.div
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="w-[min(740px,92vw)] rounded-xl border overflow-hidden shadow-2xl"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
              <HugeiconsIcon icon={Search01Icon} size={14} color="var(--text-dim)" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command…"
                className="flex-1 bg-transparent text-[14px] outline-none"
                style={{ color: 'var(--text)' }}
              />
              <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                <Kbd keys="↑" size="xs" />
                <Kbd keys="↓" size="xs" />
                <Kbd keys="Enter" size="xs" />
                <Kbd keys="Esc" size="xs" />
              </div>
            </div>
            <div className="max-h-[55vh] overflow-auto p-2">
              {filtered.map((cmd, idx) => {
                const active = idx === activeIdx
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      cmd.run()
                      onClose()
                    }}
                    className="w-full text-left rounded-lg px-3 py-2 border mb-1"
                    style={{
                      borderColor: active ? 'var(--accent)' : 'transparent',
                      background: active ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-elev) 88%)' : 'transparent',
                    }}
                  >
                    <div className="text-[13px]" style={{ color: 'var(--text)' }}>{cmd.label}</div>
                    {cmd.hint && (
                      <div className="mt-1">
                        <Kbd keys={cmd.hint} size="xs" />
                      </div>
                    )}
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <div className="px-2 py-4 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  No matching commands
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
