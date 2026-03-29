import { Fragment } from 'react'

const KEY_LABELS = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

export default function Kbd({ keys, size = 'sm', className = '' }) {
  const parsed = normalizeKeys(keys)
  if (!parsed.length) return null

  return (
    <span className={`kbd-chip kbd-${size} ${className}`.trim()}>
      {parsed.map((key, idx) => (
        <Fragment key={`${key}-${idx}`}>
          {idx > 0 && <span className="kbd-plus">+</span>}
          <kbd className="kbd-key">{key}</kbd>
        </Fragment>
      ))}
    </span>
  )
}

function normalizeKeys(keys) {
  const raw = Array.isArray(keys)
    ? keys
    : String(keys ?? '').split('+')

  return raw
    .map(k => String(k).trim())
    .filter(Boolean)
    .map(formatKey)
}

function formatKey(key) {
  const lowered = key.toLowerCase()
  if (KEY_LABELS[lowered]) return KEY_LABELS[lowered]
  if (key.length === 1) return key.toUpperCase()
  return key.slice(0, 1).toUpperCase() + key.slice(1)
}
