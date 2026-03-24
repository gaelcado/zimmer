import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tree01Icon, ListViewIcon, HierarchyCircle01Icon } from '@hugeicons/core-free-icons'
import Kbd from './components/Kbd.jsx'
import StatsBar from './components/StatsBar.jsx'
import SplashLoader from './components/SplashLoader.jsx'
import Sidebar from './components/Sidebar.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import Terminal from './components/Terminal.jsx'
import AgentLineageTimeline from './components/AgentLineageTimeline.jsx'
import ConversationPanel from './components/ConversationPanel.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import ContextScene from './components/ContextScene.jsx'
import LogsScene from './components/LogsScene.jsx'
import WorkflowScene from './components/WorkflowScene.jsx'
import { useSessionData } from './hooks/useSessionData.js'
import { buildTurnGroups } from './lib/turns.js'

const SCENE_ORDER = ['monitor', 'terminal', 'context', 'logs', 'workflow']
const ASK_DOCS_URL = 'https://deepwiki.com/NousResearch/hermes-agent'
const AGENT_DELEGATE_TOOLS = new Set(['spawn_agent', 'run_agent', 'call_agent', 'delegate_agent'])

export default function App() {
  const { sessions, activeTasks, llmActive, stats, processes, connected, gatewayHealthy, lastToolEnd, lastWorkflowEvent, honchoStatus, pendingPermissions, queueDepths, fetchTools, killSession, renameSession } = useSessionData()
  const [scene, setScene] = useState('monitor')
  const [theme, setTheme] = useState(() => localStorage.getItem('zimmer_theme') || 'dark')
  const [lineageFocus, setLineageFocus] = useState(() => localStorage.getItem('zimmer_lineage_focus') || 'all')
  const [monitorView, setMonitorView] = useState(() => localStorage.getItem('zimmer_monitor_view') || 'list')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [filter, setFilter] = useState('active')
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [selectedTurn, setSelectedTurn] = useState(null)
  const [sessionBlocks, setSessionBlocks] = useState({})
  const fetchingRef = useRef(new Set())
  const openAskDocs = useCallback(() => {
    window.open(ASK_DOCS_URL, '_blank', 'noopener,noreferrer')
  }, [])

  const filteredSessions = useMemo(() => {
    if (filter === 'all') return sessions
    if (filter === 'active') return sessions.filter(s => !s.ended_at)
    return sessions.filter(s => s.source === filter)
  }, [sessions, filter])

  const displaySessions = useMemo(
    () => withInferredParents(filteredSessions, sessionBlocks),
    [filteredSessions, sessionBlocks],
  )

  const lineageSessions = useMemo(() => {
    if (lineageFocus !== 'branch' || !selectedSessionId) return displaySessions
    const byId = new Map(displaySessions.map(s => [s.id, s]))
    if (!byId.has(selectedSessionId)) return displaySessions
    const keep = new Set([selectedSessionId])

    let cur = byId.get(selectedSessionId)
    while (cur?.parent_session_id && byId.has(cur.parent_session_id)) {
      keep.add(cur.parent_session_id)
      cur = byId.get(cur.parent_session_id)
    }

    const children = new Map()
    for (const s of displaySessions) {
      if (!s.parent_session_id) continue
      if (!children.has(s.parent_session_id)) children.set(s.parent_session_id, [])
      children.get(s.parent_session_id).push(s.id)
    }
    const stack = [selectedSessionId]
    while (stack.length) {
      const id = stack.pop()
      for (const childId of children.get(id) || []) {
        if (keep.has(childId)) continue
        keep.add(childId)
        stack.push(childId)
      }
    }
    return displaySessions.filter(s => keep.has(s.id))
  }, [displaySessions, lineageFocus, selectedSessionId])

  useEffect(() => {
    if (lineageSessions.length === 0) {
      if (selectedSessionId) setSelectedSessionId(null)
      return
    }
    const stillVisible = selectedSessionId && lineageSessions.some(s => s.id === selectedSessionId)
    if (stillVisible) return
    const pick = lineageSessions.find(s => !s.ended_at) ?? lineageSessions[0]
    if (pick) setSelectedSessionId(pick.id)
  }, [lineageSessions, selectedSessionId])

  useEffect(() => {
    filteredSessions.forEach(s => {
      if (sessionBlocks[s.id] !== undefined) return
      if (fetchingRef.current.has(s.id)) return
      fetchingRef.current.add(s.id)
      fetchTools(s.id).then(blocks => {
        fetchingRef.current.delete(s.id)
        setSessionBlocks(prev => ({ ...prev, [s.id]: blocks }))
      }).catch(() => {
        fetchingRef.current.delete(s.id)
      })
    })
  }, [filteredSessions, sessionBlocks, fetchTools])

  useEffect(() => {
    if (!lastToolEnd) return
    const activeIds = sessions.filter(s => !s.ended_at).map(s => s.id)
    for (const id of activeIds) {
      if (fetchingRef.current.has(id)) continue
      fetchingRef.current.add(id)
      fetchTools(id).then(blocks => {
        fetchingRef.current.delete(id)
        setSessionBlocks(prev => ({ ...prev, [id]: blocks }))
      }).catch(() => {
        fetchingRef.current.delete(id)
      })
    }
  }, [lastToolEnd, sessions, fetchTools])

  useEffect(() => {
    const interval = setInterval(() => {
      const activeIds = sessions.filter(s => !s.ended_at).map(s => s.id)
      for (const id of activeIds) {
        if (fetchingRef.current.has(id)) continue
        fetchingRef.current.add(id)
        fetchTools(id).then(blocks => {
          fetchingRef.current.delete(id)
          setSessionBlocks(prev => ({ ...prev, [id]: blocks }))
        }).catch(() => {
          fetchingRef.current.delete(id)
        })
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [sessions, fetchTools])

  const sessionActiveTasks = useMemo(() => {
    const bySession = new Map()
    for (const [callId, task] of activeTasks) {
      const sid = task.session_id
      if (!sid) continue
      if (!bySession.has(sid)) bySession.set(sid, new Map())
      bySession.get(sid).set(callId, task)
    }
    return bySession
  }, [activeTasks])

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null
  const childCountBySession = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      if (!s.parent_session_id) continue
      map.set(s.parent_session_id, (map.get(s.parent_session_id) ?? 0) + 1)
    }
    return map
  }, [sessions])

  const turnsForSelected = useMemo(() => {
    if (!selectedSessionId) return []
    const dbBlocks = sessionBlocks[selectedSessionId] ?? []
    const liveTasks = sessionActiveTasks.get(selectedSessionId) ?? new Map()
    return buildTurnGroups(dbBlocks, liveTasks)
  }, [selectedSessionId, sessionBlocks, sessionActiveTasks])

  const sessionTurnGroups = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      map.set(
        s.id,
        buildTurnGroups(sessionBlocks[s.id] ?? [], sessionActiveTasks.get(s.id) ?? new Map())
      )
    }
    return map
  }, [sessions, sessionBlocks, sessionActiveTasks])

  useEffect(() => {
    if (!selectedTurn) return
    const stillExists = turnsForSelected.some(t => t.started_at === selectedTurn.started_at && t._tool_count === selectedTurn._tool_count)
    if (!stillExists) setSelectedTurn(null)
  }, [turnsForSelected, selectedTurn])

  const handleSelectSession = useCallback((id) => {
    setSelectedSessionId(id)
    setSelectedTurn(null)
  }, [])

  const handleKillSession = useCallback(async (id) => {
    const ok = await killSession(id)
    if (!ok) return
    setSessionBlocks(prev => {
      const next = { ...prev }
      delete next[id]
      fetchingRef.current.delete(id)
      return next
    })
  }, [killSession])

  useEffect(() => { localStorage.setItem('zimmer_theme', theme) }, [theme])
  useEffect(() => { localStorage.setItem('zimmer_lineage_focus', lineageFocus) }, [lineageFocus])
  useEffect(() => { localStorage.setItem('zimmer_monitor_view', monitorView) }, [monitorView])
  useEffect(() => { if (scene === 'terminal') setTerminalMounted(true) }, [scene])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.closest('.xterm')) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && (key === 'k' || (e.shiftKey && key === 'p'))) {
        e.preventDefault()
        setPaletteOpen(true)
      }
      if (e.key === '1') setScene('monitor')
      else if (e.key === '2') setScene('terminal')
      else if (e.key === '3') setScene('context')
      else if (e.key === '4') setScene('logs')
      else if (e.key === '5') setScene('workflow')
      else if (e.key === '6') openAskDocs()
      else if (e.key === 'v') setMonitorView(prev => prev === 'tree' ? 'list' : 'tree')
      else if (e.key === 't') setTheme(prev => prev === 'dark' ? 'light' : 'dark')
      else if (e.key === 'f') setLineageFocus(prev => prev === 'all' ? 'branch' : 'all')
      else if (e.key === 'j' || e.key === 'ArrowDown') moveSelection(1)
      else if (e.key === 'k' || e.key === 'ArrowUp') moveSelection(-1)
      else if (e.key === 'Tab') {
        e.preventDefault()
        const idx = SCENE_ORDER.indexOf(scene)
        setScene(SCENE_ORDER[(idx + 1) % SCENE_ORDER.length])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scene, lineageSessions, selectedSessionId, openAskDocs])

  function moveSelection(dir) {
    if (!lineageSessions.length) return
    const idx = lineageSessions.findIndex(s => s.id === selectedSessionId)
    const next = idx < 0 ? 0 : Math.max(0, Math.min(lineageSessions.length - 1, idx + dir))
    setSelectedSessionId(lineageSessions[next].id)
    setSelectedTurn(null)
  }

  const commands = useMemo(() => ([
    { id: 'scene-monitor', label: 'Open Monitor', hint: '1', run: () => setScene('monitor') },
    { id: 'scene-terminal', label: 'Open Terminal', hint: '2', run: () => setScene('terminal') },
    { id: 'scene-context', label: 'Open Context Editor', hint: '3', run: () => setScene('context') },
    { id: 'scene-logs', label: 'Open Logs', hint: '4', run: () => setScene('logs') },
    { id: 'scene-workflow', label: 'Open Workflow Builder', hint: '5', run: () => setScene('workflow') },
    { id: 'open-ask-docs', label: 'Open Ask Docs', hint: '6', run: openAskDocs },
    { id: 'toggle-view', label: `Switch to ${monitorView === 'tree' ? 'List' : 'Tree'} View`, hint: 'V', run: () => setMonitorView(v => v === 'tree' ? 'list' : 'tree') },
    { id: 'toggle-theme', label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`, hint: 'T', run: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark') },
    { id: 'toggle-focus', label: `Lineage Focus: ${lineageFocus === 'all' ? 'Branch' : 'All'}`, hint: 'F', run: () => setLineageFocus(prev => prev === 'all' ? 'branch' : 'all') },
  ]), [theme, lineageFocus, monitorView, openAskDocs])

  const middlePanel = (
    <div className="flex-1 min-w-0 border-l border-r flex flex-col" style={{ borderColor: 'var(--border)' }}>
      <ConversationPanel
        sessionId={selectedSessionId}
        turns={turnsForSelected}
        selectedTurn={selectedTurn}
        onSelectTurn={setSelectedTurn}
      />
    </div>
  )

  const detailPanel = (
    <DetailPanel
      block={selectedTurn}
      session={selectedSession}
      childCountBySession={childCountBySession}
      onClose={() => setSelectedTurn(null)}
      onKillSession={handleKillSession}
      onRename={renameSession}
      llmActive={llmActive}
    />
  )

  const splashReady = connected || sessions.length > 0

  return (
    <div className={`app-root theme-${theme} flex flex-col h-screen overflow-hidden`} style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <SplashLoader ready={splashReady} />
      <StatsBar
        stats={stats}
        processCount={processes.length}
        connected={connected}
        gatewayHealthy={gatewayHealthy}
        honchoStatus={honchoStatus}
        scene={scene}
        onSceneChange={setScene}
        theme={theme}
        onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
        onOpenAskDocs={openAskDocs}
      />

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {scene === 'monitor' && (
            <motion.div
              key="scene-monitor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="h-full flex flex-col"
            >
              <MonitorToolbar
                monitorView={monitorView}
                onSetMonitorView={setMonitorView}
                lineageFocus={lineageFocus}
                onToggleLineageFocus={() => setLineageFocus(prev => prev === 'all' ? 'branch' : 'all')}
              />
              <div className="flex-1 min-h-0 flex">
              {monitorView === 'tree' ? (
                <>
                  <div className="flex-1 min-w-0">
                    <AgentLineageTimeline
                      sessions={lineageSessions}
                      selectedSessionId={selectedSessionId}
                      onSelectSession={handleSelectSession}
                      llmActive={llmActive}
                      sessionActiveTasks={sessionActiveTasks}
                      sessionTurnGroups={sessionTurnGroups}
                      selectedTurn={selectedTurn}
                      onSelectTurn={setSelectedTurn}
                    />
                  </div>
                  {detailPanel}
                </>
              ) : (
                <>
                  <Sidebar
                    sessions={sessions}
                    filteredSessions={lineageSessions}
                    filter={filter}
                    onFilterChange={setFilter}
                    selectedId={selectedSessionId}
                    onSelect={handleSelectSession}
                    llmActive={llmActive}
                    sessionActiveTasks={sessionActiveTasks}
                    pendingPermissions={pendingPermissions}
                    queueDepths={queueDepths}
                    onRename={renameSession}
                  />
                  {middlePanel}
                  {detailPanel}
                </>
              )}
              </div>
            </motion.div>
          )}

          {scene === 'terminal' && (
            <motion.div key="scene-terminal" className="h-full" />
          )}

          {scene === 'context' && (
            <motion.div
              key="scene-context"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="h-full"
            >
              <ContextScene />
            </motion.div>
          )}

          {scene === 'logs' && (
            <motion.div
              key="scene-logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="h-full"
            >
              <LogsScene />
            </motion.div>
          )}

          {scene === 'workflow' && (
            <motion.div
              key="scene-workflow"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="h-full"
            >
              <WorkflowScene lastWorkflowEvent={lastWorkflowEvent} />
            </motion.div>
          )}

        </AnimatePresence>

        {terminalMounted && (
          <div className={`absolute inset-0 ${scene === 'terminal' ? 'block' : 'hidden'}`}>
            <Terminal onClose={() => setScene('monitor')} />
          </div>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  )
}

function withInferredParents(sessions, sessionBlocks) {
  if (!sessions.length) return sessions
  const byId = new Map(sessions.map(s => [s.id, s]))
  const sorted = [...sessions].sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
  const inferred = new Map()

  for (const child of sorted) {
    if (child.parent_session_id && byId.has(child.parent_session_id)) continue
    const childStart = child.started_at
    if (!childStart) continue
    let best = null

    for (const parent of sorted) {
      if (parent.id === child.id) continue
      const pStart = parent.started_at || 0
      const pEnd = parent.ended_at ?? Number.POSITIVE_INFINITY
      if (pStart > childStart + 2) continue
      if (pEnd < childStart - 6) continue

      const blocks = sessionBlocks[parent.id]
      if (!Array.isArray(blocks) || blocks.length === 0) continue
      const hits = blocks.filter(b => {
        const tool = String(b.tool_name || '').toLowerCase()
        if (!AGENT_DELEGATE_TOOLS.has(tool)) return false
        const ts = b.ended_at ?? b.started_at ?? 0
        return Math.abs(ts - childStart) <= 25
      })
      if (!hits.length) continue
      const proximity = Math.min(...hits.map(b => Math.abs((b.ended_at ?? b.started_at ?? 0) - childStart)))
      const score = proximity + Math.max(0, (childStart - pStart) * 0.01)
      if (!best || score < best.score) {
        best = { id: parent.id, score }
      }
    }

    if (best) inferred.set(child.id, best.id)
  }

  return sessions.map(s => {
    const inferredParent = inferred.get(s.id)
    if (!inferredParent) return s
    return { ...s, parent_session_id: inferredParent, _lineage_inferred: true }
  })
}

function MonitorToolbar({ monitorView, onSetMonitorView, lineageFocus, onToggleLineageFocus }) {
  return (
    <div className="flex-none flex items-center gap-1 px-3 h-8 border-b text-[11px]" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      <ViewBtn active={monitorView === 'list'} onClick={() => onSetMonitorView('list')} icon={ListViewIcon} label="List" hint="V" />
      <ViewBtn active={monitorView === 'tree'} onClick={() => onSetMonitorView('tree')} icon={Tree01Icon} label="Tree" hint="V" />
      <span className="mx-1.5" style={{ color: 'var(--border)' }}>|</span>
      <ViewBtn active={lineageFocus === 'branch'} onClick={onToggleLineageFocus} icon={HierarchyCircle01Icon} label="Focus branch" hint="F" />
    </div>
  )
}

function ViewBtn({ active, onClick, icon, label, hint }) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      className="px-2 py-0.5 rounded flex items-center gap-1.5 transition-colors"
      style={{
        background: active ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-dim)',
      }}
      title={`${label} (${hint})`}
    >
      <HugeiconsIcon icon={icon} size={11} color="currentColor" />
      {label}
      <Kbd keys={hint} size="xs" />
    </button>
  )
}

