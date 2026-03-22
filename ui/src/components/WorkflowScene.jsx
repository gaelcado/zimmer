import { useEffect, useMemo, useState, useCallback } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BookOpen01Icon,
  Add01Icon,
  Settings01Icon,
  FolderCodeIcon,
  HierarchyCircle01Icon,
} from '@hugeicons/core-free-icons'

export default function WorkflowScene() {
  const [workflows, setWorkflows] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedSkill, setSelectedSkill] = useState('')
  const [newNodeType, setNewNodeType] = useState('skill')
  const [promptTemplate, setPromptTemplate] = useState('Process this input and produce a concise result.')
  const [edgeFrom, setEdgeFrom] = useState('')
  const [edgeTo, setEdgeTo] = useState('')
  const [validation, setValidation] = useState(null)
  const [runInput, setRunInput] = useState('')
  const [runDry, setRunDry] = useState(true)
  const [runRetries, setRunRetries] = useState(0)
  const [runBackoffMs, setRunBackoffMs] = useState(350)
  const [runId, setRunId] = useState(null)
  const [runData, setRunData] = useState(null)
  const [runList, setRunList] = useState([])
  const [running, setRunning] = useState(false)
  const [exportText, setExportText] = useState('')
  const [importText, setImportText] = useState('')
  const [workflowToken, setWorkflowToken] = useState(() => localStorage.getItem('zimmer_workflow_token') || '')
  const [authRequired, setAuthRequired] = useState(false)

  const wfFetch = useCallback(async (url, options = {}) => {
    const headers = { ...(options.headers || {}) }
    const token = (workflowToken || '').trim()
    if (token) headers['x-zimmer-token'] = token
    return fetch(url, { ...options, headers })
  }, [workflowToken])

  useEffect(() => {
    localStorage.setItem('zimmer_workflow_token', workflowToken)
  }, [workflowToken])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wfRes, skillsRes] = await Promise.all([
        wfFetch('/api/workflows'),
        wfFetch('/api/workflows/skills?platform=cli'),
      ])
      const wfData = wfRes.ok ? await wfRes.json() : []
      const skillsData = skillsRes.ok ? await skillsRes.json() : { skills: [] }
      const nextWorkflows = Array.isArray(wfData) ? wfData : []
      setWorkflows(nextWorkflows)
      setSkills(Array.isArray(skillsData.skills) ? skillsData.skills : [])
      if (nextWorkflows.length > 0) {
        const pick = nextWorkflows.find(w => w.id === selectedId) ?? nextWorkflows[0]
        setSelectedId(pick.id)
      } else {
        setSelectedId(null)
        setDraft(null)
      }
    } catch {
      setWorkflows([])
      setSkills([])
      setSelectedId(null)
      setDraft(null)
    }
    setLoading(false)
  }, [selectedId, wfFetch])

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const res = await wfFetch('/api/workflows/auth')
        const data = await res.json()
        setAuthRequired(Boolean(data.required))
      } catch {
        setAuthRequired(false)
      }
    }
    loadAuth()
  }, [wfFetch])

  useEffect(() => {
    if (!selectedId) return
    const loadRuns = async () => {
      try {
        const res = await wfFetch(`/api/workflows/runs?workflow_id=${encodeURIComponent(selectedId)}&limit=10`)
        const data = await res.json()
        if (data.ok && Array.isArray(data.runs)) {
          setRunList(data.runs)
        }
      } catch {}
    }
    loadRuns()
  }, [selectedId, runData, wfFetch])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    const run = async () => {
      try {
        const res = await wfFetch(`/api/workflows/${encodeURIComponent(selectedId)}`)
        const data = await res.json()
        if (data.ok && data.workflow) {
          setDraft(data.workflow)
        }
      } catch {
        setDraft(null)
      }
    }
    run()
  }, [selectedId, wfFetch])

  const dirty = useMemo(() => {
    if (!draft?.id) return false
    const row = workflows.find(w => w.id === draft.id)
    if (!row) return true
    return row.name !== draft.name || (row.description || '') !== (draft.description || '')
  }, [draft, workflows])

  const createWorkflow = useCallback(async () => {
    const name = newName.trim() || 'New Workflow'
    try {
      const res = await wfFetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newDescription.trim() }),
      })
      const data = await res.json()
      if (data.ok && data.workflow?.id) {
        setNewName('')
        setNewDescription('')
        await load()
        setSelectedId(data.workflow.id)
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Create failed' })
        setTimeout(() => setSaveMsg(null), 3000)
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Failed to create workflow' })
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }, [newName, newDescription, load, wfFetch])

  const saveWorkflow = useCallback(async () => {
    if (!draft?.id) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        graph: draft.graph,
        defaults: draft.defaults,
        metadata: draft.metadata,
        version: draft.version,
      }
      const res = await wfFetch(`/api/workflows/${encodeURIComponent(draft.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok && data.workflow) {
        setDraft(data.workflow)
        setSaveMsg({ type: 'ok', text: 'Saved' })
        await load()
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Save failed' })
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Save failed' })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 3000)
  }, [draft, load, wfFetch])

  const addNode = useCallback(() => {
    if (!draft) return
    const graph = draft.graph || { nodes: [], edges: [] }
    if (newNodeType === 'skill' && !selectedSkill) return
    if (newNodeType === 'prompt' && !promptTemplate.trim()) return
    const nodeId = `node_${Date.now()}`
    const node = newNodeType === 'skill'
      ? {
          id: nodeId,
          type: 'skill',
          skill: selectedSkill,
          label: selectedSkill,
        }
      : {
          id: nodeId,
          type: 'prompt',
          label: 'Prompt Node',
          prompt: promptTemplate.trim(),
        }
    const next = {
      ...draft,
      graph: {
        nodes: [
          ...(Array.isArray(graph.nodes) ? graph.nodes : []),
          node,
        ],
        edges: Array.isArray(graph.edges) ? graph.edges : [],
      },
    }
    setDraft(next)
  }, [draft, newNodeType, selectedSkill, promptTemplate])

  const addEdge = useCallback(() => {
    if (!draft || !edgeFrom || !edgeTo || edgeFrom === edgeTo) return
    const graph = draft.graph || { nodes: [], edges: [] }
    const edges = Array.isArray(graph.edges) ? graph.edges : []
    if (edges.some(e => e.from === edgeFrom && e.to === edgeTo)) return
    setDraft({
      ...draft,
      graph: {
        nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
        edges: [...edges, { from: edgeFrom, to: edgeTo }],
      },
    })
  }, [draft, edgeFrom, edgeTo])

  const startRun = useCallback(async () => {
    if (!draft?.id || running) return
    setRunning(true)
    setRunData(null)
    setRunId(null)
    try {
      const res = await wfFetch(`/api/workflows/${encodeURIComponent(draft.id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: runInput,
          dry_run: runDry,
          timeout_sec: 120,
          default_retries: runRetries,
          retry_backoff_ms: runBackoffMs,
        }),
      })
      const data = await res.json()
      if (data.ok && data.run_id) {
        setRunId(data.run_id)
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Run failed' })
        setTimeout(() => setSaveMsg(null), 3000)
        setRunning(false)
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Run failed' })
      setTimeout(() => setSaveMsg(null), 3000)
      setRunning(false)
    }
  }, [draft, runInput, runDry, runRetries, runBackoffMs, running, wfFetch])

  const cancelRun = useCallback(async () => {
    if (!runData?.run_id || runData.status !== 'running') return
    try {
      await wfFetch(`/api/workflows/runs/${encodeURIComponent(runData.run_id)}/cancel`, { method: 'POST' })
    } catch {}
  }, [runData, wfFetch])

  const validateWorkflow = useCallback(async () => {
    if (!draft?.id) return
    try {
      const res = await wfFetch(`/api/workflows/${encodeURIComponent(draft.id)}/validate`)
      const data = await res.json()
      setValidation(data)
    } catch {
      setValidation({ ok: false, error: 'validation_failed', issues: ['validation request failed'] })
    }
  }, [draft, wfFetch])

  const exportWorkflow = useCallback(async () => {
    if (!draft?.id) return
    try {
      const res = await wfFetch(`/api/workflows/${encodeURIComponent(draft.id)}/export`)
      const data = await res.json()
      if (data.ok) {
        setExportText(data.content || '')
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Export failed' })
        setTimeout(() => setSaveMsg(null), 3000)
      }
    } catch {}
  }, [draft, wfFetch])

  const importWorkflow = useCallback(async () => {
    const content = importText.trim()
    if (!content) return
    try {
      const res = await wfFetch('/api/workflows/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, overwrite: false }),
      })
      const data = await res.json()
      if (data.ok && data.workflow?.id) {
        setImportText('')
        await load()
        setSelectedId(data.workflow.id)
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Import failed' })
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Import failed' })
    }
    setTimeout(() => setSaveMsg(null), 3500)
  }, [importText, load, wfFetch])

  useEffect(() => {
    if (!runId) return
    let stop = false
    const poll = async () => {
      try {
        const res = await wfFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`)
        const data = await res.json()
        if (!stop && data.ok && data.run) {
          setRunData(data.run)
          if (data.run.status === 'running') {
            setTimeout(poll, 900)
          } else {
            setRunning(false)
          }
        } else if (!stop) {
          setRunning(false)
        }
      } catch {
        if (!stop) setRunning(false)
      }
    }
    poll()
    return () => { stop = true }
  }, [runId, wfFetch])

  if (loading) {
    return <div className="h-full flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>Loading workflows...</div>
  }

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--bg)' }}>
      <aside className="w-72 flex-none border-r flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Workflow Builder</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>Orchestrate reusable Hermes flows.</div>
          {authRequired && (
            <div className="mt-2">
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-dim)' }}>API Token Required</div>
              <input
                value={workflowToken}
                onChange={(e) => setWorkflowToken(e.target.value)}
                placeholder="x-zimmer-token"
                className="w-full px-2 py-1 rounded border text-[11px] outline-none"
                style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
          )}
        </div>

        <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--border)' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workflow name"
            className="w-full px-2 py-1.5 rounded border text-[12px] outline-none"
            style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="What this workflow does"
            rows={2}
            className="w-full px-2 py-1.5 rounded border text-[12px] outline-none resize-none"
            style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            onClick={createWorkflow}
            className="w-full px-2 py-1.5 rounded text-[12px] border flex items-center justify-center gap-1"
            style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff' }}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} color="currentColor" />
            Create Workflow
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {workflows.map(w => {
            const active = selectedId === w.id
            return (
              <button
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                className="w-full text-left rounded border px-2.5 py-2 mb-1"
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  background: active ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-elev) 88%)' : 'transparent',
                }}
              >
                <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{w.name}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{w.node_count} nodes · {w.edge_count} edges</div>
              </button>
            )
          })}
          {workflows.length === 0 && (
            <div className="text-[12px] px-2 py-4" style={{ color: 'var(--text-dim)' }}>No workflows yet.</div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {!draft ? (
          <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
              <HugeiconsIcon icon={HierarchyCircle01Icon} size={24} color="var(--text-dim)" />
              <div className="mt-2 text-[14px]" style={{ color: 'var(--text)' }}>Select a workflow</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-dim)' }}>Create one from the left sidebar to start orchestration design.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-none border-b px-4 h-11 flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={BookOpen01Icon} size={14} color="var(--accent)" />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Workflow Definition</span>
                <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{draft.id}</span>
              </div>
              <div className="flex items-center gap-2">
                {saveMsg && <span className="text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>{saveMsg.text}</span>}
                <button
                  onClick={validateWorkflow}
                  className="px-2.5 py-1 rounded border text-[12px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
                >
                  Validate
                </button>
                <button
                  onClick={exportWorkflow}
                  className="px-2.5 py-1 rounded border text-[12px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
                >
                  Export
                </button>
                <button
                  onClick={saveWorkflow}
                  disabled={saving || !dirty}
                  className="px-2.5 py-1 rounded border text-[12px] flex items-center gap-1"
                  style={{
                    borderColor: dirty ? 'var(--accent)' : 'var(--border)',
                    background: dirty ? 'var(--accent)' : 'transparent',
                    color: dirty ? '#fff' : 'var(--text-dim)',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <HugeiconsIcon icon={Settings01Icon} size={12} color="currentColor" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 grid gap-4" style={{ gridTemplateColumns: 'minmax(320px, 1fr) minmax(340px, 1fr)' }}>
              <section className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
                <div className="text-[12px] mb-2" style={{ color: 'var(--text-dim)' }}>Metadata</div>
                <div className="space-y-2">
                  <input
                    value={draft.name || ''}
                    onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border text-[12px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  />
                  <textarea
                    value={draft.description || ''}
                    onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
                    rows={4}
                    className="w-full px-2 py-1.5 rounded border text-[12px] outline-none resize-y"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  />
                </div>
              </section>

              <section className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Graph Nodes</div>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{skills.length} available</span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={newNodeType}
                    onChange={(e) => setNewNodeType(e.target.value)}
                    className="px-2 py-1.5 rounded border text-[12px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="skill">Skill</option>
                    <option value="prompt">Prompt</option>
                  </select>
                  {newNodeType === 'skill' ? (
                  <select
                    value={selectedSkill}
                    onChange={(e) => setSelectedSkill(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded border text-[12px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="">Select a skill</option>
                    {skills.map(s => (
                      <option key={s.path} value={s.name}>{s.name} ({s.category})</option>
                    ))}
                  </select>
                  ) : (
                    <input
                      value={promptTemplate}
                      onChange={(e) => setPromptTemplate(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded border text-[12px] outline-none"
                      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      placeholder="Prompt template (use {input})"
                    />
                  )}
                  <button
                    onClick={addNode}
                    disabled={newNodeType === 'skill' ? !selectedSkill : !promptTemplate.trim()}
                    className="px-2 py-1.5 rounded border text-[12px]"
                    style={{
                      borderColor: (newNodeType === 'skill' ? selectedSkill : promptTemplate.trim()) ? 'var(--accent)' : 'var(--border)',
                      background: (newNodeType === 'skill' ? selectedSkill : promptTemplate.trim()) ? 'var(--accent)' : 'transparent',
                      color: (newNodeType === 'skill' ? selectedSkill : promptTemplate.trim()) ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    Add
                  </button>
                </div>

                <div className="rounded border p-2 max-h-[360px] overflow-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
                  {(draft.graph?.nodes || []).length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>No nodes yet. Add a skill node to start composing the graph.</div>
                  ) : (
                    (draft.graph?.nodes || []).map((n) => (
                      <div key={n.id} className="py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                        <div className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>{n.label || n.skill || n.id}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{n.type} · {n.id}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>Edges</div>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={edgeFrom}
                    onChange={(e) => setEdgeFrom(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border text-[11px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="">from</option>
                    {(draft.graph?.nodes || []).map(n => <option key={`from_${n.id}`} value={n.id}>{n.id}</option>)}
                  </select>
                  <select
                    value={edgeTo}
                    onChange={(e) => setEdgeTo(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border text-[11px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="">to</option>
                    {(draft.graph?.nodes || []).map(n => <option key={`to_${n.id}`} value={n.id}>{n.id}</option>)}
                  </select>
                  <button onClick={addEdge} className="px-2 py-1 rounded border text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    Add Edge
                  </button>
                </div>
                <div className="mt-2 max-h-[90px] overflow-auto text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {(draft.graph?.edges || []).map((e, i) => (
                    <div key={`${e.from}_${e.to}_${i}`}>{e.from} {'->'} {e.to}</div>
                  ))}
                </div>
              </section>

              <section className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel)', gridColumn: '1 / -1' }}>
                <div className="flex items-center gap-2 mb-2">
                  <HugeiconsIcon icon={FolderCodeIcon} size={12} color="var(--text-dim)" />
                  <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Storage</span>
                </div>
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Workflows are stored in <code>~/.hermes/workflows/*.yaml</code>. This is plugin-local and does not require Hermes core patches.
                </div>
                {exportText && (
                  <textarea
                    value={exportText}
                    onChange={(e) => setExportText(e.target.value)}
                    rows={8}
                    className="mt-2 w-full px-2 py-1.5 rounded border text-[11px] outline-none"
                    style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)', fontFamily: '"JetBrains Mono", monospace' }}
                  />
                )}
                <div className="mt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>Import YAML</div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  placeholder="Paste workflow YAML"
                  className="mt-1 w-full px-2 py-1.5 rounded border text-[11px] outline-none"
                  style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)', fontFamily: '"JetBrains Mono", monospace' }}
                />
                <button onClick={importWorkflow} className="mt-2 px-2 py-1 rounded border text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                  Import as New
                </button>
              </section>

              <section className="rounded border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel)', gridColumn: '1 / -1' }}>
                <div className="text-[12px] mb-2" style={{ color: 'var(--text-dim)' }}>Run Workflow</div>
                <textarea
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  rows={3}
                  placeholder="Input payload for the workflow run"
                  className="w-full px-2 py-1.5 rounded border text-[12px] outline-none resize-y"
                  style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
                    <input type="checkbox" checked={runDry} onChange={(e) => setRunDry(e.target.checked)} />
                    Dry Run
                  </label>
                  <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
                    Retries
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={runRetries}
                      onChange={(e) => setRunRetries(Number(e.target.value || 0))}
                      className="w-14 px-1 py-0.5 rounded border"
                      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    />
                  </label>
                  <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
                    Backoff ms
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={runBackoffMs}
                      onChange={(e) => setRunBackoffMs(Number(e.target.value || 0))}
                      className="w-20 px-1 py-0.5 rounded border"
                      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    />
                  </label>
                  <button
                    onClick={startRun}
                    disabled={running || !draft?.id}
                    className="px-2.5 py-1 rounded border text-[12px]"
                    style={{
                      borderColor: 'var(--accent)',
                      background: 'var(--accent)',
                      color: '#fff',
                      opacity: running ? 0.6 : 1,
                    }}
                  >
                    {running ? 'Running...' : 'Run'}
                  </button>
                  {runData?.status === 'running' && (
                    <button onClick={cancelRun} className="px-2.5 py-1 rounded border text-[12px]" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                      Cancel
                    </button>
                  )}
                  {runData && (
                    <span className="text-[11px]" style={{ color: runData.status === 'ok' ? 'var(--ok)' : runData.status === 'error' ? 'var(--danger)' : 'var(--text-dim)' }}>
                      {runData.status}
                    </span>
                  )}
                </div>
                {validation && (
                  <div className="mt-2 text-[11px]" style={{ color: validation.ok ? 'var(--ok)' : 'var(--danger)' }}>
                    {validation.ok ? `Valid DAG · order: ${(validation.order || []).join(' -> ')}` : (validation.issues || [validation.error || 'invalid']).join(' | ')}
                  </div>
                )}
                {runData && (
                  <div className="mt-3 rounded border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
                    <div className="text-[11px] mb-1" style={{ color: 'var(--text-dim)' }}>
                      Run {runData.run_id} · steps {Array.isArray(runData.steps) ? runData.steps.length : 0}
                    </div>
                    <div className="max-h-[220px] overflow-auto text-[11px]">
                      {(runData.steps || []).map((s) => (
                        <div key={`${s.node_id}_${s.index}`} className="py-1 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                          <div style={{ color: 'var(--text)' }}>{s.index + 1}. {s.node_type} ({s.node_id})</div>
                          <div style={{ color: s.status === 'ok' ? 'var(--ok)' : s.status === 'error' ? 'var(--danger)' : 'var(--text-dim)' }}>
                            {s.status}
                          </div>
                          {s.error && <div style={{ color: 'var(--danger)' }}>{s.error}</div>}
                          {s.output_preview && <div style={{ color: 'var(--text-dim)' }}>{s.output_preview}</div>}
                        </div>
                      ))}
                    </div>
                    {runData.final_output && (
                      <pre className="mt-2 p-2 rounded overflow-auto text-[11px]" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
{runData.final_output}
                      </pre>
                    )}
                    {Array.isArray(runData.events) && runData.events.length > 0 && (
                      <div className="mt-2 max-h-[160px] overflow-auto text-[10px]" style={{ color: 'var(--text-dim)' }}>
                        {runData.events.map((ev, idx) => (
                          <div key={`ev_${idx}`}>
                            {new Date((ev.ts || 0) * 1000).toISOString()} [{ev.level}] {ev.node_id ? `${ev.node_id} ` : ''}{ev.attempt ? `#${ev.attempt} ` : ''}{ev.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {runList.length > 0 && (
                  <div className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Recent runs: {runList.map(r => `${r.run_id}:${r.status}`).join(' · ')}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
