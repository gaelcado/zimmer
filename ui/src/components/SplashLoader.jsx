import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export default function SplashLoader({ ready }) {
  const [visible, setVisible] = useState(true)
  const [minMet, setMinMet] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinMet(true), 2200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (ready && minMet) setVisible(false)
  }, [ready, minMet])

  const done = ready && minMet

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'var(--bg)' }}
        >
          {/* Image */}
          <motion.img
            src="/zimmer.jpg"
            alt=""
            aria-hidden="true"
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              width: 'min(440px, 72vmin)',
              height: 'auto',
              userSelect: 'none',
            }}
          />

          {/* Loading bar */}
          <div className="absolute bottom-0 left-0 right-0" style={{ height: '3px', background: 'var(--bg-elev-2)' }}>
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: done ? '100%' : '65%' }}
              transition={
                done
                  ? { duration: 0.4, ease: 'easeOut' }
                  : { duration: 2.0, ease: [0.16, 1, 0.3, 1], delay: 0.2 }
              }
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 60%, var(--ok) 100%)',
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
