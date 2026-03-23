/**
 * Context scene — tabbed editor for agent context files.
 *
 * Tabs: Soul · Workspace · Memories · Config · Skills
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  MagicWand01Icon, FolderCodeIcon, Brain01Icon, User02Icon,
  Settings01Icon, BookOpen01Icon, Add01Icon, Cancel01Icon,
  Calendar01Icon,
} from '@hugeicons/core-free-icons'
import { marked } from 'marked'
import Kbd from './Kbd.jsx'
import CronPanel from './CronPanel.jsx'

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true })

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 7000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ac.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` }
    }
    return { ok: true, data }
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, error: 'Request timed out' }
    return { ok: false, error: String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function renderMarkdownSafe(value) {
  try {
    return marked.parse(String(value || ''))
  } catch {
    return '<p>Failed to render markdown.</p>'
  }
}

const TABS = [
  { key: 'soul',      label: 'Soul',      desc: 'Agent identity & persona (SOUL.md)',       icon: MagicWand01Icon },
  { key: 'workspace', label: 'Workspace', desc: 'Project context files (AGENTS.md, etc.)',  icon: FolderCodeIcon },
  { key: 'memories',  label: 'Memories',  desc: 'Persistent memory & user profile',          icon: Brain01Icon },
  { key: 'honcho',    label: 'Honcho',    desc: 'Cross-session memory & personalization',    icon: User02Icon },
  { key: 'config',    label: 'Config',    desc: 'Agent configuration (config.yaml)',         icon: Settings01Icon },
  { key: 'skills',    label: 'Skills',    desc: 'Installed skill catalog',                   icon: BookOpen01Icon },
  { key: 'cron',      label: 'Cron',      desc: 'Scheduled jobs & automation',               icon: Calendar01Icon },
]

export default function ContextScene() {
  const [tab, setTab] = useState('soul')

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Tab sidebar */}
      <nav className="flex-none w-48 border-r flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="px-3 pt-3 pb-2">
          <span className="text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Context</span>
        </div>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="text-left px-3 py-2.5 border-l-2 transition-colors"
              style={{
                borderColor: active ? 'var(--accent)' : 'transparent',
                background: active ? 'color-mix(in oklab, var(--accent) 10%, var(--panel) 90%)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={t.icon} size={13} color={active ? 'var(--accent)' : 'currentColor'} />
                <span className="text-[13px] font-medium">{t.label}</span>
              </div>
              <div className="text-[10px] mt-0.5 ml-5" style={{ color: 'var(--text-dim)' }}>{t.desc}</div>
            </button>
          )
        })}
      </nav>

      {/* Content area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {tab === 'soul' && <FileEditor endpoint="/api/context/soul" label="SOUL.md" language="markdown" />}
        {tab === 'workspace' && <WorkspaceEditor />}
        {tab === 'memories' && <MemoriesEditor />}
        {tab === 'honcho' && <HonchoPanel />}
        {tab === 'config' && <FileEditor endpoint="/api/context/config" putEndpoint="/api/context/config" label="config.yaml" language="yaml" />}
        {tab === 'skills' && <SkillsBrowser />}
        {tab === 'cron' && <CronPanel />}
      </div>
    </div>
  )
}

// ── View mode toggle ────────────────────────────────────────────────────────

function ViewModeToggle({ mode, onModeChange, language }) {
  const displayMode = language === 'yaml' || language === 'json' ? 'formatted' : 'preview'
  const modes = language === 'yaml' || language === 'json'
    ? [{ key: displayMode, label: 'Display' }, { key: 'edit', label: 'Edit' }]
    : [{ key: displayMode, label: 'Display' }, { key: 'edit', label: 'Edit' }]

  return (
    <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => onModeChange(m.key)}
          className="px-2 py-0.5 text-[11px] transition-colors"
          style={{
            background: mode === m.key ? 'color-mix(in oklab, var(--accent) 18%, var(--bg-elev) 82%)' : 'transparent',
            color: mode === m.key ? 'var(--text)' : 'var(--text-dim)',
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

// ── Markdown renderer ───────────────────────────────────────────────────────

function MarkdownPreview({ content }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content || '')
    } catch {
      return '<p>Error rendering markdown</p>'
    }
  }, [content])

  return (
    <div
      className="prose-zimmer overflow-auto p-5 text-[13px] leading-relaxed"
      style={{ color: 'var(--text)' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── YAML/JSON formatted view ────────────────────────────────────────────────

function FormattedView({ content, language }) {
  const formatted = useMemo(() => {
    if (language === 'json') {
      try {
        return JSON.stringify(JSON.parse(content), null, 2)
      } catch {
        return content
      }
    }
    // YAML: just display with syntax highlighting hints
    return content
  }, [content, language])

  const lines = formatted.split('\n')

  return (
    <div className="overflow-auto p-3 text-[13px] leading-relaxed" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="select-none text-right mr-3 flex-none" style={{ width: 36, color: 'var(--text-dim)', opacity: 0.5 }}>{i + 1}</span>
          <SyntaxLine line={line} language={language} />
        </div>
      ))}
    </div>
  )
}

function SyntaxLine({ line, language }) {
  if (language === 'yaml') {
    // Key: value highlighting
    const keyMatch = line.match(/^(\s*)([\w._-]+)(:)(.*)$/)
    if (keyMatch) {
      const [, indent, key, colon, rest] = keyMatch
      return (
        <span>
          <span>{indent}</span>
          <span style={{ color: 'var(--accent-2)' }}>{key}</span>
          <span style={{ color: 'var(--text-dim)' }}>{colon}</span>
          <YamlValue text={rest} />
        </span>
      )
    }
    // Comment
    if (line.trimStart().startsWith('#')) {
      return <span style={{ color: 'var(--text-dim)' }}>{line}</span>
    }
    // List item
    const listMatch = line.match(/^(\s*)(- )(.*)$/)
    if (listMatch) {
      return (
        <span>
          <span>{listMatch[1]}</span>
          <span style={{ color: 'var(--text-dim)' }}>{listMatch[2]}</span>
          <span style={{ color: 'var(--text)' }}>{listMatch[3]}</span>
        </span>
      )
    }
  }

  if (language === 'json') {
    // Key highlighting
    const jsonKeyMatch = line.match(/^(\s*)"([^"]+)"(:)(.*)$/)
    if (jsonKeyMatch) {
      const [, indent, key, colon, rest] = jsonKeyMatch
      return (
        <span>
          <span>{indent}</span>
          <span style={{ color: 'var(--accent-2)' }}>"{key}"</span>
          <span style={{ color: 'var(--text-dim)' }}>{colon}</span>
          <JsonValue text={rest} />
        </span>
      )
    }
  }

  return <span style={{ color: 'var(--text)' }}>{line}</span>
}

function YamlValue({ text }) {
  const trimmed = text.trim()
  if (trimmed === 'true' || trimmed === 'false') return <span style={{ color: 'var(--warn)' }}>{text}</span>
  if (/^\d+(\.\d+)?$/.test(trimmed)) return <span style={{ color: 'var(--ok)' }}>{text}</span>
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return <span style={{ color: '#fb7185' }}>{text}</span>
  return <span style={{ color: 'var(--text)' }}>{text}</span>
}

function JsonValue({ text }) {
  const trimmed = text.trim().replace(/,$/, '')
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return <span style={{ color: 'var(--warn)' }}>{text}</span>
  if (/^-?\d+(\.\d+)?/.test(trimmed)) return <span style={{ color: 'var(--ok)' }}>{text}</span>
  if (trimmed.startsWith('"')) return <span style={{ color: '#fb7185' }}>{text}</span>
  return <span style={{ color: 'var(--text)' }}>{text}</span>
}

// ── File editor (reusable) ──────────────────────────────────────────────────

function FileEditor({ endpoint, putEndpoint, label, readOnly = false, language = 'markdown', filePath: externalPath }) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [filePath, setFilePath] = useState(externalPath || '')
  const [viewMode, setViewMode] = useState(() =>
    language === 'yaml' || language === 'json' ? 'formatted' : 'preview'
  )
  const textRef = useRef(null)

  const resolvedEndpoint = useMemo(() => {
    if (externalPath) return `/api/context/file?path=${encodeURIComponent(externalPath)}`
    return endpoint
  }, [endpoint, externalPath])

  const resolvedPutEndpoint = useMemo(() => {
    if (externalPath) return `/api/context/file?path=${encodeURIComponent(externalPath)}`
    return putEndpoint || endpoint
  }, [endpoint, putEndpoint, externalPath])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(resolvedEndpoint)
      const data = await res.json()
      const text = data.content ?? ''
      setContent(text)
      setOriginal(text)
      if (!externalPath) setFilePath(data.path ?? '')
    } catch {
      setContent('')
      setOriginal('')
    }
    setLoading(false)
  }, [resolvedEndpoint, externalPath])

  useEffect(() => { load() }, [load])

  const save = useCallback(async () => {
    if (readOnly) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(resolvedPutEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (data.ok) {
        setOriginal(content)
        setSaveMsg({ type: 'ok', text: `Saved (${data.bytes} bytes)` })
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Save failed' })
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: String(e) })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 4000)
  }, [content, resolvedPutEndpoint, readOnly])

  // Ctrl+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!readOnly) save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, readOnly])

  // Format JSON on demand
  const formatContent = useCallback(() => {
    if (language === 'json') {
      try {
        setContent(JSON.stringify(JSON.parse(content), null, 2))
      } catch { /* invalid JSON, leave as-is */ }
    }
  }, [content, language])

  const dirty = content !== original
  const lines = content.split('\n').length
  const chars = content.length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-none flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
          {filePath && <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{filePath}</span>}
          {dirty && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 15%, transparent)' }}>modified</span>}
          {readOnly && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-dim)', background: 'var(--bg-elev-2)' }}>read-only</span>}
        </div>
        <div className="flex items-center gap-3">
          <ViewModeToggle mode={viewMode} onModeChange={setViewMode} language={language} />
          {language === 'json' && viewMode === 'edit' && (
            <button onClick={formatContent} className="text-[11px] px-2 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Format
            </button>
          )}
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{lines} lines · {chars} chars</span>
          {saveMsg && (
            <span className="text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
              {saveMsg.text}
            </span>
          )}
          {!readOnly && (
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1 rounded text-[12px] border transition-colors flex items-center gap-1.5"
              style={{
                borderColor: dirty ? 'var(--accent)' : 'var(--border)',
                background: dirty ? 'var(--accent)' : 'transparent',
                color: dirty ? '#fff' : 'var(--text-dim)',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : (
                <>
                  Save
                  <Kbd keys={['Ctrl', 'S']} size="xs" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Editor / Preview */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>
          Loading...
        </div>
      ) : viewMode === 'preview' ? (
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--bg)' }}>
          <MarkdownPreview content={content} />
        </div>
      ) : viewMode === 'formatted' ? (
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--bg)' }}>
          <FormattedView content={content} language={language} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <LineNumbers content={content} textRef={textRef} />
          <textarea
            ref={textRef}
            value={content}
            onChange={readOnly ? undefined : (e) => setContent(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            className="flex-1 resize-none outline-none p-3 text-[13px] leading-relaxed"
            style={{
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: '"JetBrains Mono", monospace',
              tabSize: 2,
              caretColor: 'var(--accent)',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Line numbers ────────────────────────────────────────────────────────────

function LineNumbers({ content, textRef }) {
  const gutterRef = useRef(null)
  const lines = content.split('\n').length

  useEffect(() => {
    const ta = textRef.current
    const gutter = gutterRef.current
    if (!ta || !gutter) return
    const sync = () => { gutter.scrollTop = ta.scrollTop }
    ta.addEventListener('scroll', sync)
    return () => ta.removeEventListener('scroll', sync)
  }, [textRef])

  return (
    <div
      ref={gutterRef}
      className="flex-none overflow-hidden select-none text-right pr-2 pt-3 text-[13px] leading-relaxed"
      style={{
        width: 48,
        color: 'var(--text-dim)',
        fontFamily: '"JetBrains Mono", monospace',
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  )
}

// ── Workspace context file editor ───────────────────────────────────────────

function WorkspaceEditor() {
  const [files, setFiles] = useState([])
  const [selectedPath, setSelectedPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/context/workspace')
      const data = await res.json()
      setFiles(data)
      if (data.length > 0) {
        setSelectedPath(prev => prev || data[0].path)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const createFile = useCallback(async (name, dir) => {
    try {
      const res = await fetch('/api/context/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, dir }),
      })
      const d = await res.json()
      if (d.ok) {
        setSelectedPath(d.path)
        setCreating(false)
        load()
      }
    } catch {}
  }, [load])

  if (loading) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-dim)' }}>Loading...</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* File selector bar */}
      <div className="flex-none px-3 h-10 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="h-full flex items-center gap-2 overflow-x-auto">
          {files.map(f => (
            <button
              key={f.path}
              onClick={() => setSelectedPath(f.path)}
              className="px-2.5 py-1 rounded text-[11px] border transition-colors whitespace-nowrap shrink-0"
              style={{
                borderColor: selectedPath === f.path ? 'var(--accent)' : 'var(--border)',
                background: selectedPath === f.path ? 'color-mix(in oklab, var(--accent) 14%, var(--bg-elev) 86%)' : 'transparent',
                color: selectedPath === f.path ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              <span className="font-medium">{f.name}</span>
              <span className="ml-1.5 opacity-50">{f.rel.replace(f.name, '').replace(/\/$/, '') || '~'}</span>
            </button>
          ))}
          <button
            onClick={() => setCreating(!creating)}
            className="px-2 py-1 rounded text-[11px] border transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            <HugeiconsIcon icon={Add01Icon} size={11} color="currentColor" />
            New
          </button>
        </div>
      </div>

      {creating && <CreateFileBar onCancel={() => setCreating(false)} onCreate={createFile} />}

      {/* Editor for selected file */}
      {selectedPath ? (
        <div className="flex-1 min-h-0">
          <FileEditor
            key={selectedPath}
            label={files.find(f => f.path === selectedPath)?.name ?? 'file'}
            filePath={selectedPath}
            language={selectedPath.endsWith('.yaml') || selectedPath.endsWith('.yml') ? 'yaml' : 'markdown'}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>
          <div className="text-center">
            <div className="text-[14px] mb-2">No workspace context files found</div>
            <div className="text-[12px]">Create an AGENTS.md or .hermes.md to add context for the agent.</div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateFileBar({ onCancel, onCreate }) {
  const [name, setName] = useState('AGENTS.md')
  const homeDir = useMemo(() => {
    // We'll use ~ as default
    return ''
  }, [])

  return (
    <div className="flex-none flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
      <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Create:</span>
      <select
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="text-[12px] px-2 py-1 rounded border outline-none"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <option value="AGENTS.md">AGENTS.md</option>
        <option value=".hermes.md">.hermes.md</option>
        <option value="HERMES.md">HERMES.md</option>
        <option value="CLAUDE.md">CLAUDE.md</option>
        <option value=".cursorrules">.cursorrules</option>
      </select>
      <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>in home directory</span>
      <button
        onClick={() => onCreate(name)}
        className="px-2.5 py-1 rounded text-[11px] border"
        style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff' }}
      >
        Create
      </button>
      <button onClick={onCancel} className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>Cancel</button>
    </div>
  )
}

// ── Memories editor (dual pane) ─────────────────────────────────────────────

function MemoriesEditor() {
  const [data, setData] = useState(null)
  const [selectedName, setSelectedName] = useState('MEMORY.md')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(null)
  const [saveMsg, setSaveMsg] = useState(null)
  const [viewByFile, setViewByFile] = useState({})
  const [contentByFile, setContentByFile] = useState({})
  const [originalByFile, setOriginalByFile] = useState({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/context/memories')
      const d = await r.json()
      setData(d)
      const nextContent = {}
      const nextOriginal = {}
      for (const [name, info] of Object.entries(d)) {
        nextContent[name] = info?.content ?? ''
        nextOriginal[name] = info?.content ?? ''
      }
      setContentByFile(nextContent)
      setOriginalByFile(nextOriginal)
      const names = Object.keys(d)
      if (names.length > 0) {
        setSelectedName(prev => (d[prev] ? prev : names[0]))
      }
    } catch {}
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveFile = useCallback(async (filename) => {
    setSaving(filename)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/context/memories/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentByFile[filename] ?? '' }),
      })
      const d = await res.json()
      if (d.ok) {
        setOriginalByFile(prev => ({ ...prev, [filename]: contentByFile[filename] ?? '' }))
        setSaveMsg({ type: 'ok', text: `${filename} saved` })
      } else {
        setSaveMsg({ type: 'error', text: d.error || 'Failed' })
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: String(e) })
    }
    setSaving(null)
    setTimeout(() => setSaveMsg(null), 4000)
  }, [contentByFile])

  const createFile = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      const res = await fetch('/api/context/memories/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const d = await res.json()
      if (d.ok) {
        setNewName('')
        setCreating(false)
        await load()
        setSelectedName(trimmed)
      } else {
        setSaveMsg({ type: 'error', text: d.error || 'Failed to create file' })
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: String(e) })
    }
  }, [newName, load])

  if (!data) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-dim)' }}>Loading...</div>
  }

  const names = Object.keys(data)
  const selectedInfo = selectedName ? data[selectedName] : null
  const selectedContent = selectedName ? (contentByFile[selectedName] ?? '') : ''
  const selectedOriginal = selectedName ? (originalByFile[selectedName] ?? '') : ''
  const selectedView = selectedName ? (viewByFile[selectedName] ?? 'preview') : 'preview'
  const charLimit = selectedName === 'MEMORY.md' ? 2200 : selectedName === 'USER.md' ? 1375 : null
  const hint = selectedName === 'MEMORY.md'
    ? 'Cross-session persistent facts (2200 char limit)'
    : selectedName === 'USER.md'
      ? 'User profile & preferences (1375 char limit)'
      : 'Markdown memory file'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Agent Memories</span>
        <div className="flex items-center gap-2 min-w-0">
          {saveMsg && (
            <span className="text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={() => setCreating(v => !v)}
            className="px-2 py-1 rounded text-[11px] border transition-colors flex items-center gap-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            <HugeiconsIcon icon={Add01Icon} size={11} color="currentColor" />
            New
          </button>
        </div>
      </div>
      <div className="flex-none px-3 h-10 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="h-full flex items-center gap-2 overflow-x-auto">
          {names.map(name => (
            <button
              key={name}
              onClick={() => setSelectedName(name)}
              className="px-2.5 py-1 rounded text-[11px] border transition-colors whitespace-nowrap shrink-0"
              style={{
                borderColor: selectedName === name ? 'var(--accent)' : 'var(--border)',
                background: selectedName === name ? 'color-mix(in oklab, var(--accent) 14%, var(--bg-elev) 86%)' : 'transparent',
                color: selectedName === name ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      {creating && (
        <div className="flex-none flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Create:</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="NOTES.md"
            className="text-[12px] px-2 py-1 rounded border outline-none"
            style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            onClick={createFile}
            className="px-2.5 py-1 rounded text-[11px] border"
            style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff' }}
          >
            Create
          </button>
          <button onClick={() => setCreating(false)} className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>Cancel</button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <MemoryPane
          label={selectedName || 'MEMORY.md'}
          hint={hint}
          path={selectedInfo?.path || ''}
          content={selectedContent}
          original={selectedOriginal}
          onChange={(next) => setContentByFile(prev => ({ ...prev, [selectedName]: next }))}
          onSave={() => saveFile(selectedName)}
          saving={saving === selectedName}
          charLimit={charLimit}
          viewMode={selectedView}
          onViewModeChange={(mode) => setViewByFile(prev => ({ ...prev, [selectedName]: mode }))}
        />
      </div>
    </div>
  )
}

function MemoryPane({ label, hint, path, content, original, onChange, onSave, saving, charLimit, viewMode, onViewModeChange }) {
  const dirty = content !== original
  const over = charLimit != null ? content.length > charLimit : false
  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
          <span className="text-[10px] ml-2" style={{ color: 'var(--text-dim)' }}>{hint}</span>
          {path && <span className="text-[10px] ml-2" style={{ color: 'var(--text-dim)' }}>{path}</span>}
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle mode={viewMode} onModeChange={onViewModeChange} language="markdown" />
          {charLimit != null ? (
            <span className="text-[10px]" style={{ color: over ? 'var(--danger)' : 'var(--text-dim)' }}>
              {content.length}/{charLimit}
            </span>
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {content.length} chars
            </span>
          )}
          {dirty && (
            <button
              onClick={onSave}
              disabled={saving}
              className="px-2 py-0.5 rounded text-[11px] border"
              style={{
                borderColor: 'var(--accent)',
                background: 'var(--accent)',
                color: '#fff',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? '...' : 'Save'}
            </button>
          )}
        </div>
      </div>
      {viewMode === 'preview' ? (
        <div className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
          <MarkdownPreview content={content} />
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none outline-none p-3 text-[12px] leading-relaxed"
          style={{
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: '"JetBrains Mono", monospace',
            caretColor: 'var(--accent)',
          }}
          placeholder={`${label} is empty — the agent will populate this over time.`}
        />
      )}
    </div>
  )
}

// ── Skills browser ──────────────────────────────────────────────────────────

function SkillsBrowser() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [skillContent, setSkillContent] = useState(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [toggling, setToggling] = useState(new Set())

  const fetchSkills = useCallback(() => {
    fetch('/api/context/skills').then(r => r.json()).then(d => {
      setSkills(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  const expandSkill = (name) => {
    if (selectedSkill === name) {
      setSelectedSkill(null)
      setSkillContent(null)
      return
    }
    setSelectedSkill(name)
    setSkillContent(null)
    setLoadingContent(true)
    fetch(`/api/context/skills/${encodeURIComponent(name)}/content`)
      .then(r => r.json())
      .then(d => { setSkillContent(d); setLoadingContent(false) })
      .catch(() => setLoadingContent(false))
  }

  const toggleSkill = async (name, disabled) => {
    setToggling(prev => new Set(prev).add(name))
    try {
      await fetch(`/api/context/skills/${encodeURIComponent(name)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled }),
      })
      fetchSkills()
    } catch { /* swallow */ }
    setToggling(prev => { const next = new Set(prev); next.delete(name); return next })
  }

  const filtered = search.trim()
    ? skills.filter(s =>
        `${s.name} ${s.description} ${s.category} ${(s.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase())
      )
    : skills

  const byCategory = {}
  for (const s of filtered) {
    const cat = s.category || 'uncategorized'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(s)
  }
  const categories = Object.keys(byCategory).sort()
  const disabledCount = skills.filter(s => s.disabled).length

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Skills ({skills.length})</span>
          {disabledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--warn) 15%, transparent)', color: 'var(--warn)' }}>
              {disabledCount} disabled
            </span>
          )}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="text-[12px] px-2.5 py-1 rounded border outline-none w-56"
          style={{
            background: 'var(--bg-elev)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        />
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>Loading...</div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {categories.map(cat => (
            <div key={cat} className="mb-6">
              <h3 className="text-[12px] uppercase tracking-[0.15em] mb-2 font-semibold" style={{ color: 'var(--text-dim)' }}>
                {cat} ({byCategory[cat].length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {byCategory[cat].map(skill => {
                  const isDisabled = skill.disabled
                  const isSelected = selectedSkill === skill.name
                  const isToggling = toggling.has(skill.name)
                  return (
                    <div key={skill.path || skill.name}>
                      <button
                        onClick={() => expandSkill(skill.name)}
                        className="w-full text-left rounded-lg border px-3 py-2.5 transition-colors"
                        style={{
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          background: isSelected
                            ? 'color-mix(in oklab, var(--accent) 10%, var(--panel) 90%)'
                            : 'var(--panel)',
                          opacity: isDisabled ? 0.5 : 1,
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{skill.name}</span>
                            {skill.version && <span className="text-[10px] flex-none" style={{ color: 'var(--text-dim)' }}>v{skill.version}</span>}
                          </div>
                          <div className="flex items-center gap-1 flex-none">
                            {skill.source && (
                              <SkillSourceBadge source={skill.source} />
                            )}
                            {skill.trust && skill.trust !== 'unknown' && (
                              <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--ok) 12%, transparent)', color: 'var(--ok)' }}>
                                {skill.trust}
                              </span>
                            )}
                            {isDisabled && (
                              <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--warn) 15%, transparent)', color: 'var(--warn)' }}>
                                off
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                          {skill.description || 'No description'}
                        </div>
                        {skill.author && (
                          <div className="text-[10px] mt-1" style={{ color: 'var(--text-dim)' }}>
                            by {skill.author}
                          </div>
                        )}
                        {skill.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {skill.tags.slice(0, 5).map(tag => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                                {tag}
                              </span>
                            ))}
                            {skill.tags.length > 5 && (
                              <span className="text-[9px] px-1.5 py-0.5" style={{ color: 'var(--text-dim)' }}>+{skill.tags.length - 5}</span>
                            )}
                          </div>
                        )}
                      </button>

                      {/* Expanded content */}
                      {isSelected && (
                        <div className="mt-1 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{skill.name}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSkill(skill.name, !isDisabled) }}
                              disabled={isToggling}
                              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
                              style={{
                                borderColor: isDisabled ? 'var(--ok)' : 'var(--warn)',
                                color: isDisabled ? 'var(--ok)' : 'var(--warn)',
                                opacity: isToggling ? 0.5 : 1,
                              }}
                            >
                              {isToggling ? '...' : isDisabled ? 'Enable' : 'Disable'}
                            </button>
                          </div>
                          {loadingContent ? (
                            <div className="text-[11px] py-2" style={{ color: 'var(--text-dim)' }}>Loading content...</div>
                          ) : skillContent?.body ? (
                            <div className="overflow-auto" style={{ maxHeight: 400 }}>
                              <MarkdownPreview content={skillContent.body} />
                            </div>
                          ) : skillContent?.content ? (
                            <pre className="text-[11px] whitespace-pre-wrap break-words" style={{ color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace', maxHeight: 400, overflow: 'auto' }}>
                              {skillContent.content}
                            </pre>
                          ) : (
                            <div className="text-[11px] py-2 italic" style={{ color: 'var(--text-dim)' }}>No SKILL.md found on filesystem</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {categories.length === 0 && (
            <div className="text-[13px] text-center py-8" style={{ color: 'var(--text-dim)' }}>
              {search ? 'No skills match your search.' : 'No skills installed.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const _SOURCE_COLORS = {
  builtin: { bg: 'color-mix(in oklab, #3b82f6 12%, transparent)', color: '#3b82f6' },
  local:   { bg: 'color-mix(in oklab, var(--ok) 12%, transparent)', color: 'var(--ok)' },
  hub:     { bg: 'color-mix(in oklab, #a855f7 12%, transparent)', color: '#a855f7' },
}

function SkillSourceBadge({ source }) {
  const s = _SOURCE_COLORS[source] || { bg: 'color-mix(in oklab, var(--text-dim) 12%, transparent)', color: 'var(--text-dim)' }
  return (
    <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>
      {source}
    </span>
  )
}

// ── Honcho panel ────────────────────────────────────────────────────────────

function HonchoPanel() {
  const [view, setView] = useState('overview')
  const [status, setStatus] = useState(null)
  const [peers, setPeers] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [config, setConfig] = useState(null)
  const [configContent, setConfigContent] = useState('')
  const [configOriginal, setConfigOriginal] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [selectedPeer, setSelectedPeer] = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionContext, setSessionContext] = useState(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [peersError, setPeersError] = useState('')
  const [sessionsError, setSessionsError] = useState('')
  const [contextError, setContextError] = useState('')

  useEffect(() => {
    fetchJsonWithTimeout('/api/honcho/status', {}, 5000)
      .then(res => setStatus(res.ok ? res.data : { configured: false, enabled: false, error: res.error }))
      .catch(() => setStatus({ configured: false, enabled: false }))
  }, [])

  const loadPeers = useCallback(async () => {
    const res = await fetchJsonWithTimeout('/api/honcho/peers', {}, 9000)
    if (!res.ok) {
      setPeers([])
      setPeersError(res.error || 'Failed to load peers')
      return
    }
    if (!Array.isArray(res.data)) {
      setPeers([])
      setPeersError('Invalid response from Honcho peers endpoint')
      return
    }
    setPeers(res.data)
    setPeersError('')
  }, [])

  const loadSessions = useCallback(async () => {
    const res = await fetchJsonWithTimeout('/api/honcho/sessions', {}, 9000)
    if (!res.ok) {
      setSessions([])
      setSessionsError(res.error || 'Failed to load sessions')
      return
    }
    if (!Array.isArray(res.data)) {
      setSessions([])
      setSessionsError('Invalid response from Honcho sessions endpoint')
      return
    }
    setSessions(res.data)
    setSessionsError('')
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/honcho/config')
      const data = await res.json()
      setConfig(data)
      setConfigContent(data.content || '')
      setConfigOriginal(data.content || '')
    } catch {}
  }, [])

  const loadSessionContext = useCallback(async (sid) => {
    if (!sid) {
      setSessionContext(null)
      setContextError('')
      return
    }
    setLoadingContext(true)
    setSessionContext(null)
    const res = await fetchJsonWithTimeout(`/api/honcho/sessions/${encodeURIComponent(sid)}/context`, {}, 10000)
    if (!res.ok) {
      setSessionContext({ error: res.error || 'Failed to load session context' })
      setContextError(res.error || 'Failed to load session context')
      setLoadingContext(false)
      return
    }
    const data = res.data && typeof res.data === 'object' ? res.data : { error: 'Invalid context response' }
    setSessionContext(data)
    setContextError(data.error || '')
    setLoadingContext(false)
  }, [])

  useEffect(() => {
    if (view === 'peers' && !peers) loadPeers()
    if (view === 'sessions' && !sessions) loadSessions()
    if (view === 'config' && !config) loadConfig()
  }, [view, peers, sessions, config, loadPeers, loadSessions, loadConfig])

  const saveConfig = useCallback(async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/honcho/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: configContent }),
      })
      const data = await res.json()
      if (data.ok) {
        setConfigOriginal(configContent)
        setSaveMsg({ type: 'ok', text: 'Saved' })
        // Refresh status
        fetchJsonWithTimeout('/api/honcho/status', {}, 5000)
          .then(r => { if (r.ok) setStatus(r.data) })
          .catch(() => {})
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Failed' })
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: String(e) })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 4000)
  }, [configContent])

  if (!status) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-dim)' }}>Loading...</div>
  }

  const views = [
    { key: 'overview', label: 'Status' },
    { key: 'peers', label: 'Peers' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'config', label: 'Config' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Honcho</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              color: status.enabled ? 'var(--ok)' : 'var(--text-dim)',
              background: status.enabled
                ? 'color-mix(in oklab, var(--ok) 15%, transparent)'
                : 'var(--bg-elev-2)',
            }}
          >
            {status.enabled ? 'connected' : status.configured ? 'disabled' : 'not configured'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className="px-2.5 py-1 rounded text-[11px] transition-colors"
              style={{
                background: view === v.key ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'transparent',
                color: view === v.key ? 'var(--text)' : 'var(--text-dim)',
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {view === 'overview' && <HonchoOverview status={status} />}
        {view === 'peers' && (
          <HonchoPeers
            peers={peers}
            error={peersError}
            onRetry={loadPeers}
            selectedPeer={selectedPeer}
            onSelectPeer={setSelectedPeer}
          />
        )}
        {view === 'sessions' && (
          <HonchoSessions
            sessions={sessions}
            error={sessionsError}
            contextError={contextError}
            onRetry={loadSessions}
            selectedSession={selectedSession}
            onSelectSession={(sid) => {
              setSelectedSession(sid)
              if (sid) loadSessionContext(sid)
            }}
            sessionContext={sessionContext}
            loadingContext={loadingContext}
          />
        )}
        {view === 'config' && (
          <HonchoConfig
            content={configContent}
            original={configOriginal}
            onChange={setConfigContent}
            onSave={saveConfig}
            saving={saving}
            saveMsg={saveMsg}
            path={config?.path}
          />
        )}
      </div>
    </div>
  )
}

function HonchoOverview({ status }) {
  const fields = [
    { label: 'Status', value: status.enabled ? 'Enabled' : status.configured ? 'Disabled' : 'Not configured', color: status.enabled ? 'var(--ok)' : 'var(--text-dim)' },
    { label: 'Workspace', value: status.workspace || '\u2014' },
    { label: 'User Peer', value: status.peer_name || '\u2014' },
    { label: 'AI Peer', value: status.ai_peer || '\u2014' },
    { label: 'Memory Mode', value: status.memory_mode || '\u2014' },
    { label: 'Recall Mode', value: status.recall_mode || '\u2014' },
    { label: 'Session Strategy', value: status.session_strategy || '\u2014' },
  ]

  return (
    <div className="p-5 max-w-lg">
      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.label} className="flex justify-between gap-4 text-[13px]">
            <span style={{ color: 'var(--text-dim)' }}>{f.label}</span>
            <span className="font-mono text-right" style={{ color: f.color || 'var(--text)' }}>{f.value}</span>
          </div>
        ))}
      </div>

      {!status.configured && (
        <div className="mt-6 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
          <div className="text-[13px] font-medium mb-2" style={{ color: 'var(--text)' }}>Get started with Honcho</div>
          <div className="text-[12px] space-y-1" style={{ color: 'var(--text-muted)' }}>
            <p>Honcho provides cross-session memory and user personalization.</p>
            <p className="font-mono text-[11px] mt-2 p-2 rounded" style={{ background: 'var(--bg)', color: 'var(--accent-2)' }}>
              hermes honcho setup
            </p>
            <p className="mt-2">Or configure manually in the Config tab.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function HonchoPeers({ peers, error, onRetry, selectedPeer, onSelectPeer }) {
  if (!peers) return <div className="p-5 text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading peers...</div>
  if (error) {
    return (
      <div className="p-5 text-[12px]" style={{ color: 'var(--danger)' }}>
        <div>{error}</div>
        <button onClick={onRetry} className="mt-2 px-2 py-1 rounded border text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
          Retry
        </button>
      </div>
    )
  }
  if (peers.length === 0) return <div className="p-5 text-[12px]" style={{ color: 'var(--text-dim)' }}>No peers found</div>

  return (
    <div className="flex h-full">
      <div className="w-56 flex-none border-r overflow-auto" style={{ borderColor: 'var(--border)' }}>
        {peers.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectPeer(p.id === selectedPeer ? null : p.id)}
            className="w-full text-left px-3 py-2.5 border-b transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: selectedPeer === p.id ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent',
            }}
          >
            <div className="text-[13px] font-medium font-mono" style={{ color: selectedPeer === p.id ? 'var(--text)' : 'var(--text-muted)' }}>
              {p.id}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {p.representation ? `${p.representation.length} chars` : 'empty'}
            </div>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {selectedPeer ? (
          (() => {
            const peer = peers.find(p => p.id === selectedPeer)
            if (!peer) return null
            return (
              <div>
                <div className="text-[13px] font-semibold mb-3 font-mono" style={{ color: 'var(--text)' }}>{peer.id}</div>
                {peer.representation ? (
                  <div className="prose-zimmer text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(peer.representation) }}
                  />
                ) : (
                  <div className="text-[12px] italic" style={{ color: 'var(--text-dim)' }}>
                    No representation built yet. Honcho builds peer representations over time from conversations.
                  </div>
                )}
              </div>
            )
          })()
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
            Select a peer to view their representation
          </div>
        )}
      </div>
    </div>
  )
}

function HonchoSessions({ sessions, error, contextError, onRetry, selectedSession, onSelectSession, sessionContext, loadingContext }) {
  if (!sessions) return <div className="p-5 text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading sessions...</div>
  if (error) {
    return (
      <div className="p-5 text-[12px]" style={{ color: 'var(--danger)' }}>
        <div>{error}</div>
        <button onClick={onRetry} className="mt-2 px-2 py-1 rounded border text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
          Retry
        </button>
      </div>
    )
  }
  if (sessions.length === 0) return <div className="p-5 text-[12px]" style={{ color: 'var(--text-dim)' }}>No Honcho sessions found</div>

  return (
    <div className="flex h-full">
      <div className="w-64 flex-none border-r overflow-auto" style={{ borderColor: 'var(--border)' }}>
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelectSession(s.id === selectedSession ? null : s.id)}
            className="w-full text-left px-3 py-2.5 border-b transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: selectedSession === s.id ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent',
            }}
          >
            <div className="text-[12px] font-mono truncate" style={{ color: selectedSession === s.id ? 'var(--text)' : 'var(--text-muted)' }}>
              {s.id}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {s.peers?.join(', ') || 'no peers'}
            </div>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {selectedSession ? (
          <div>
            <div className="text-[13px] font-semibold mb-3 font-mono" style={{ color: 'var(--text)' }}>{selectedSession}</div>
            {loadingContext ? (
              <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading context...</div>
            ) : contextError ? (
              <div className="text-[12px]" style={{ color: '#ef4444' }}>{contextError}</div>
            ) : sessionContext?.error ? (
              <div className="text-[12px]" style={{ color: '#ef4444' }}>{sessionContext.error}</div>
            ) : sessionContext ? (
              <div className="space-y-4 text-[12px]">
                <ContextField label="Messages" value={`${sessionContext.messages_count ?? 0} messages`} />
                {sessionContext.summary && <ContextField label="Summary" value={sessionContext.summary} markdown />}
                {sessionContext.peer_representation && <ContextField label="Peer Representation" value={sessionContext.peer_representation} markdown />}
                {sessionContext.peer_card && <ContextField label="Peer Card" value={sessionContext.peer_card} markdown />}
                {!sessionContext.summary && !sessionContext.peer_representation && !sessionContext.peer_card && (
                  <div className="italic" style={{ color: 'var(--text-dim)' }}>No context built for this session yet.</div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
            Select a session to view its context
          </div>
        )}
      </div>
    </div>
  )
}

function ContextField({ label, value, markdown }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
      {markdown ? (
        <div className="prose-zimmer text-[12px] leading-relaxed p-3 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--text-muted)' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(value) }}
        />
      ) : (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{value}</div>
      )}
    </div>
  )
}

function HonchoConfig({ content, original, onChange, onSave, saving, saveMsg, path }) {
  const textRef = useRef(null)
  const dirty = content !== original

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSave, dirty])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>config.json</span>
          {path && <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{path}</span>}
          {dirty && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 15%, transparent)' }}>modified</span>}
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className="text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : '#ef4444' }}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="px-3 py-1 rounded text-[11px] border transition-colors flex items-center gap-1.5"
            style={{
              borderColor: dirty ? 'var(--accent)' : 'var(--border)',
              background: dirty ? 'var(--accent)' : 'transparent',
              color: dirty ? '#fff' : 'var(--text-dim)',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : (
              <>
                Save
                <Kbd keys={['Ctrl', 'S']} size="xs" />
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LineNumbers content={content} textRef={textRef} />
        <textarea
          ref={textRef}
          value={content}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none outline-none p-3 text-[13px] leading-relaxed"
          style={{
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: '"JetBrains Mono", monospace',
            tabSize: 2,
            caretColor: 'var(--accent)',
          }}
        />
      </div>
    </div>
  )
}
