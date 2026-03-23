/**
 * Tool metadata from the Hermes registry: emojis, display names.
 * Fetched once from /api/tools/meta and cached globally.
 */
import { useState, useEffect } from 'react'

// Fallback emojis for tools that may not be in the registry
const FALLBACK_EMOJIS = {
  terminal:         '💻',
  web_search:       '🔍',
  web_extract:      '📄',
  web_crawl:        '🕸️',
  browser_navigate: '🌐',
  browser_click:    '👆',
  browser_type:     '⌨️',
  browser_scroll:   '📜',
  browser_snapshot: '📸',
  browser_press:    '⌨️',
  browser_back:     '◀️',
  browser_close:    '🚪',
  browser_vision:   '👁️',
  browser_console:  '🖥️',
  browser_get_images: '🖼️',
  read_file:        '📖',
  write_file:       '✍️',
  patch:            '🔧',
  search_files:     '🔎',
  memory:           '🧠',
  todo:             '📋',
  session_search:   '🔍',
  clarify:          '❓',
  cronjob:          '⏰',
  delegate_task:    '🔀',
  execute_code:     '🐍',
  image_generate:   '🎨',
  text_to_speech:   '🔊',
  vision_analyze:   '👁️',
  mixture_of_agents:'🧠',
  skill_view:       '📚',
  skills_list:      '📚',
  skill_manage:     '📝',
  send_message:     '📨',
  process:          '⚙️',
}

let _cache = null
let _promise = null

async function loadMeta() {
  if (_cache) return _cache
  if (_promise) return _promise
  _promise = fetch('/api/tools/meta')
    .then(r => r.ok ? r.json() : {})
    .then(data => { _cache = data; return data })
    .catch(() => { _cache = {}; return {} })
  return _promise
}

export function useToolMeta() {
  const [meta, setMeta] = useState(_cache || {})
  useEffect(() => {
    if (_cache) { setMeta(_cache); return }
    loadMeta().then(setMeta)
  }, [])
  return meta
}

/**
 * Get the emoji for a tool name.
 * Priority: registry > fallback map > prefix heuristic > ⚡
 */
export function toolEmoji(toolName, meta = {}) {
  if (!toolName) return '⚡'
  const entry = meta[toolName]
  if (entry?.emoji) return entry.emoji
  if (FALLBACK_EMOJIS[toolName]) return FALLBACK_EMOJIS[toolName]
  const lower = toolName.toLowerCase()
  if (lower.startsWith('browser')) return '🌐'
  if (lower.startsWith('web')) return '🔍'
  if (lower.startsWith('read') || lower.startsWith('write') || lower.startsWith('file')) return '📄'
  if (lower.startsWith('agent') || lower.startsWith('spawn') || lower.startsWith('delegate')) return '🔀'
  if (lower.startsWith('terminal') || lower.startsWith('exec') || lower.startsWith('run')) return '💻'
  if (lower.startsWith('memory') || lower.startsWith('remember')) return '🧠'
  return '⚡'
}
