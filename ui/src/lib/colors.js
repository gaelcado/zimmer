/** Tool name → hex color mapping (DAW track colors). */

const TOOL_COLORS = {
  // Terminal / code execution — teal
  terminal: '#2dd4bf',
  execute_code: '#2dd4bf',
  run_code: '#2dd4bf',

  // Web / browser — sky
  web_search: '#38bdf8',
  browser_navigate: '#38bdf8',
  browser_click: '#38bdf8',
  browser_type: '#38bdf8',
  browser_screenshot: '#38bdf8',
  web_fetch: '#38bdf8',
  fetch: '#38bdf8',

  // File tools — amber
  read_file: '#fbbf24',
  write_file: '#fbbf24',
  file_tools: '#fbbf24',
  list_files: '#fbbf24',
  glob: '#fbbf24',
  grep: '#fbbf24',
  edit_file: '#fbbf24',

  // Delegate / sub-agents — violet (matches accent)
  delegate: '#a78bfa',
  run_agent: '#a78bfa',
  spawn_agent: '#a78bfa',
  call_agent: '#a78bfa',

  // Memory / todo — rose
  memory: '#fb7185',
  todo: '#fb7185',
  remember: '#fb7185',
  recall: '#fb7185',
}

const CATEGORY_COLORS = {
  terminal: '#2dd4bf',
  web: '#38bdf8',
  file: '#fbbf24',
  delegate: '#a78bfa',
  memory: '#fb7185',
  default: '#71717a',
}

/**
 * Get the color for a tool name.
 * Falls back to default gray for unknown tools.
 */
export function toolColor(toolName) {
  if (!toolName) return CATEGORY_COLORS.default
  const lower = toolName.toLowerCase()
  if (TOOL_COLORS[lower]) return TOOL_COLORS[lower]
  // Prefix matching
  if (lower.startsWith('browser') || lower.startsWith('web')) return CATEGORY_COLORS.web
  if (lower.startsWith('file') || lower.startsWith('read') || lower.startsWith('write')) return CATEGORY_COLORS.file
  if (lower.startsWith('delegate') || lower.startsWith('agent')) return CATEGORY_COLORS.delegate
  if (lower.startsWith('memo') || lower.startsWith('todo')) return CATEGORY_COLORS.memory
  if (lower.startsWith('terminal') || lower.startsWith('exec') || lower.startsWith('run')) return CATEGORY_COLORS.terminal
  return CATEGORY_COLORS.default
}

/** Return a dimmed (30% opacity) version for background fills. */
export function toolColorDim(toolName) {
  return toolColor(toolName) + '4d'
}

/** All unique tool categories for the legend. */
export const CATEGORIES = Object.entries(CATEGORY_COLORS).map(([name, color]) => ({ name, color }))
