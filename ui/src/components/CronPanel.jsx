/**
 * Cron jobs management panel for the Context view.
 * Split-pane: job list (left) + job detail/editor (right).
 */

import { useState, useEffect, useCallback } from 'react'

const SCHEDULE_KINDS = ['cron', 'interval', 'delay', 'once']

export default function CronPanel() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(null) // draft of the job being edited
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [search, setSearch] = useState('')

  const fetchJobs = useCallback(() => {
    fetch('/api/context/cron')
      .then(r => r.json())
      .then(d => { setJobs(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const selectJob = (id) => {
    setSelectedId(id)
    setEditing(null)
    setIsNew(false)
    setSaveMsg(null)
    setConfirmDelete(false)
    if (!id) { setDetail(null); return }
    setLoadingDetail(true)
    fetch(`/api/context/cron/${id}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoadingDetail(false) })
      .catch(() => setLoadingDetail(false))
  }

  const startNew = () => {
    setSelectedId(null)
    setIsNew(true)
    setSaveMsg(null)
    setConfirmDelete(false)
    setEditing({
      name: '', prompt: '', skills: [], skill: '',
      model: '', provider: '', base_url: '', api_key_env: '',
      schedule: { kind: 'cron', expr: '', display: '' },
      schedule_display: '', deliver: '', enabled: true,
    })
  }

  const startEdit = () => {
    if (detail) setEditing({ ...detail })
  }

  const cancelEdit = () => {
    setEditing(null)
    setIsNew(false)
    setSaveMsg(null)
  }

  const saveJob = async () => {
    if (!editing) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const url = isNew ? '/api/context/cron' : `/api/context/cron/${selectedId}`
      const method = isNew ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const data = await res.json()
      if (data.ok) {
        setSaveMsg({ type: 'ok', text: isNew ? 'Created' : 'Saved' })
        fetchJobs()
        if (isNew && data.job?.id) {
          setIsNew(false)
          selectJob(data.job.id)
        } else {
          setEditing(null)
          if (data.job) setDetail(data.job)
        }
      } else {
        setSaveMsg({ type: 'err', text: data.error || 'Save failed' })
      }
    } catch (e) {
      setSaveMsg({ type: 'err', text: String(e) })
    }
    setSaving(false)
  }

  const deleteJob = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/context/cron/${selectedId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        setSelectedId(null)
        setDetail(null)
        setEditing(null)
        setConfirmDelete(false)
        fetchJobs()
      } else {
        setSaveMsg({ type: 'err', text: data.error || 'Delete failed' })
      }
    } catch (e) {
      setSaveMsg({ type: 'err', text: String(e) })
    }
    setSaving(false)
  }

  const toggleJob = async (jobId, enabled) => {
    try {
      await fetch(`/api/context/cron/${jobId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      fetchJobs()
      if (jobId === selectedId && detail) {
        setDetail(prev => prev ? { ...prev, enabled, state: enabled ? 'scheduled' : 'paused' } : prev)
      }
    } catch { /* swallow */ }
  }

  const filtered = search.trim()
    ? jobs.filter(j => `${j.name} ${j.schedule_display}`.toLowerCase().includes(search.toLowerCase()))
    : jobs

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Left: job list */}
      <div className="flex-none w-72 border-r flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="flex-none flex items-center justify-between px-3 h-11 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Jobs ({jobs.length})</span>
          <button
            onClick={startNew}
            className="text-[11px] px-2 py-1 rounded border transition-colors"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            + New
          </button>
        </div>
        <div className="flex-none px-2 py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs..."
            className="w-full text-[12px] px-2 py-1 rounded border outline-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {loading && <div className="text-[12px] text-center py-4" style={{ color: 'var(--text-dim)' }}>Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-[12px] text-center py-4" style={{ color: 'var(--text-dim)' }}>
              {search ? 'No matching jobs.' : 'No cron jobs.'}
            </div>
          )}
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              selected={job.id === selectedId}
              onSelect={() => selectJob(job.id)}
              onToggle={(enabled) => toggleJob(job.id, enabled)}
            />
          ))}
        </div>
      </div>

      {/* Right: detail / editor */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {isNew && editing ? (
          <JobEditor
            draft={editing}
            onChange={setEditing}
            onSave={saveJob}
            onCancel={cancelEdit}
            saving={saving}
            saveMsg={saveMsg}
            isNew
          />
        ) : selectedId && detail ? (
          editing ? (
            <JobEditor
              draft={editing}
              onChange={setEditing}
              onSave={saveJob}
              onCancel={cancelEdit}
              saving={saving}
              saveMsg={saveMsg}
            />
          ) : (
            <JobDetail
              job={detail}
              loading={loadingDetail}
              onEdit={startEdit}
              onDelete={deleteJob}
              onToggle={(enabled) => toggleJob(selectedId, enabled)}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              saving={saving}
              saveMsg={saveMsg}
            />
          )
        ) : !isNew ? (
          <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {jobs.length > 0 ? 'Select a job' : 'No cron jobs configured'}
          </div>
        ) : null}
      </div>
    </div>
  )
}


function JobCard({ job, selected, onSelect, onToggle }) {
  const statusColor = !job.enabled ? 'var(--warn)'
    : job.last_status === 'ok' ? 'var(--ok)'
    : job.last_status === 'error' ? '#ef4444'
    : 'var(--text-dim)'

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-lg border px-2.5 py-2 transition-colors"
      style={{
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        background: selected
          ? 'color-mix(in oklab, var(--accent) 12%, var(--panel) 88%)'
          : 'var(--panel)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="flex-none w-2 h-2 rounded-full"
              style={{ background: statusColor }}
            />
            <span className="text-[12px] truncate font-medium" style={{ color: selected ? 'var(--text)' : 'var(--text-muted)' }}>
              {job.name || 'Untitled'}
            </span>
          </div>
          <div className="text-[10px] mt-0.5 ml-3.5 truncate" style={{ color: 'var(--text-dim)' }}>
            {job.schedule_display || 'No schedule'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(!job.enabled) }}
            className="text-[9px] px-1.5 py-0.5 rounded border"
            style={{
              borderColor: job.enabled ? 'var(--ok)' : 'var(--border)',
              color: job.enabled ? 'var(--ok)' : 'var(--text-dim)',
              background: job.enabled ? 'color-mix(in oklab, var(--ok) 10%, transparent)' : 'transparent',
            }}
          >
            {job.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      {job.next_run_at && (
        <div className="text-[9px] mt-1 ml-3.5" style={{ color: 'var(--text-dim)' }}>
          next: {fmtRelTime(job.next_run_at)}
        </div>
      )}
    </button>
  )
}


function JobDetail({ job, loading, onEdit, onDelete, onToggle, confirmDelete, setConfirmDelete, saving, saveMsg }) {
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading...</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 h-12 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>{job.name || 'Untitled'}</span>
          <StatusBadge enabled={job.enabled} status={job.last_status} />
        </div>
        <div className="flex items-center gap-2 flex-none">
          <button
            onClick={() => onToggle(!job.enabled)}
            className="text-[11px] px-2.5 py-1 rounded border transition-colors"
            style={{
              borderColor: job.enabled ? 'var(--ok)' : 'var(--border)',
              color: job.enabled ? 'var(--ok)' : 'var(--text-dim)',
            }}
          >
            {job.enabled ? 'Enabled' : 'Paused'}
          </button>
          <button
            onClick={onEdit}
            className="text-[11px] px-2.5 py-1 rounded border transition-colors"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            Edit
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[11px] px-2.5 py-1 rounded border transition-colors"
              style={{ borderColor: '#ef4444', color: '#ef4444' }}
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={onDelete}
                disabled={saving}
                className="text-[11px] px-2.5 py-1 rounded border"
                style={{ borderColor: '#ef4444', background: '#ef4444', color: '#fff', opacity: saving ? 0.5 : 1 }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[11px] px-2 py-1"
                style={{ color: 'var(--text-dim)' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {saveMsg && (
        <div className="flex-none px-4 py-1.5 text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : '#ef4444' }}>
          {saveMsg.text}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <FieldGroup label="Schedule">
          <div className="text-[13px]" style={{ color: 'var(--text)' }}>
            {job.schedule_display || job.schedule?.display || 'Not set'}
          </div>
          {job.schedule?.expr && (
            <div className="text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text-dim)' }}>
              {job.schedule.kind}: {job.schedule.expr}
            </div>
          )}
        </FieldGroup>

        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Model">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{job.model || '—'}</span>
          </FieldGroup>
          <FieldGroup label="Provider">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{job.provider || '—'}</span>
          </FieldGroup>
          <FieldGroup label="Deliver">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{job.deliver || '—'}</span>
          </FieldGroup>
          <FieldGroup label="API Key Env">
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{job.api_key_env || '—'}</span>
          </FieldGroup>
        </div>

        {(job.skills?.length > 0 || job.skill) && (
          <FieldGroup label="Skills">
            <div className="flex flex-wrap gap-1">
              {(job.skills || [job.skill]).filter(Boolean).map(s => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  {s}
                </span>
              ))}
            </div>
          </FieldGroup>
        )}

        <div className="grid grid-cols-3 gap-4">
          <FieldGroup label="Last Run">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {job.last_run_at ? fmtRelTime(job.last_run_at) : '—'}
            </span>
          </FieldGroup>
          <FieldGroup label="Next Run">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {job.next_run_at ? fmtRelTime(job.next_run_at) : '—'}
            </span>
          </FieldGroup>
          <FieldGroup label="Repeats">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {job.repeat?.completed ?? 0} done{job.repeat?.times != null ? ` / ${job.repeat.times}` : ''}
            </span>
          </FieldGroup>
        </div>

        {job.last_error && (
          <FieldGroup label="Last Error">
            <pre className="text-[11px] whitespace-pre-wrap break-words" style={{ color: '#ef4444', fontFamily: '"JetBrains Mono", monospace' }}>
              {job.last_error}
            </pre>
          </FieldGroup>
        )}

        <FieldGroup label="Prompt">
          <pre
            className="text-[12px] leading-relaxed whitespace-pre-wrap break-words rounded border p-3"
            style={{
              color: 'var(--text-muted)',
              fontFamily: '"JetBrains Mono", monospace',
              background: 'var(--bg-elev)',
              borderColor: 'var(--border)',
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            {job.prompt || '(empty)'}
          </pre>
        </FieldGroup>

        {job.origin && Object.keys(job.origin).length > 0 && (
          <FieldGroup label="Origin">
            <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {job.origin.platform && <span>{job.origin.platform}</span>}
              {job.origin.chat_name && <span> — {job.origin.chat_name}</span>}
            </div>
          </FieldGroup>
        )}
      </div>
    </div>
  )
}


function JobEditor({ draft, onChange, onSave, onCancel, saving, saveMsg, isNew }) {
  const update = (key, val) => onChange(prev => ({ ...prev, [key]: val }))
  const updateSchedule = (key, val) =>
    onChange(prev => ({ ...prev, schedule: { ...(prev.schedule || {}), [key]: val } }))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-none flex items-center justify-between px-4 h-12 border-b" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
          {isNew ? 'New Cron Job' : `Edit: ${draft.name || 'Untitled'}`}
        </span>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className="text-[11px]" style={{ color: saveMsg.type === 'ok' ? 'var(--ok)' : '#ef4444' }}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={onSave}
            disabled={saving}
            className="text-[11px] px-3 py-1 rounded border"
            style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff', opacity: saving ? 0.5 : 1 }}
          >
            {saving ? '...' : isNew ? 'Create' : 'Save'}
          </button>
          <button onClick={onCancel} className="text-[11px] px-2 py-1" style={{ color: 'var(--text-dim)' }}>Cancel</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        <FormField label="Name" value={draft.name || ''} onChange={v => update('name', v)} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-[0.1em] mb-1 block" style={{ color: 'var(--text-dim)' }}>Schedule Kind</label>
            <select
              value={draft.schedule?.kind || 'cron'}
              onChange={e => updateSchedule('kind', e.target.value)}
              className="w-full text-[12px] px-2 py-1.5 rounded border outline-none"
              style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {SCHEDULE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <FormField label="Expression" value={draft.schedule?.expr || ''} onChange={v => updateSchedule('expr', v)} placeholder="0 9 * * *" />
        </div>
        <FormField label="Schedule Display" value={draft.schedule_display || ''} onChange={v => update('schedule_display', v)} placeholder="Daily 09:00 CET" />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Model" value={draft.model || ''} onChange={v => update('model', v)} />
          <FormField label="Provider" value={draft.provider || ''} onChange={v => update('provider', v)} />
          <FormField label="Base URL" value={draft.base_url || ''} onChange={v => update('base_url', v)} />
          <FormField label="API Key Env" value={draft.api_key_env || ''} onChange={v => update('api_key_env', v)} placeholder="OPENAI_API_KEY" />
        </div>

        <FormField label="Deliver" value={draft.deliver || ''} onChange={v => update('deliver', v)} placeholder="telegram" />
        <FormField label="Skills (comma-separated)" value={(draft.skills || []).join(', ')} onChange={v => update('skills', v.split(',').map(s => s.trim()).filter(Boolean))} />

        <div>
          <label className="text-[10px] uppercase tracking-[0.1em] mb-1 block" style={{ color: 'var(--text-dim)' }}>Prompt</label>
          <textarea
            value={draft.prompt || ''}
            onChange={e => update('prompt', e.target.value)}
            spellCheck={false}
            rows={14}
            className="w-full resize-none outline-none rounded border p-3 text-[12px] leading-relaxed"
            style={{
              background: 'var(--bg-elev)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
              fontFamily: '"JetBrains Mono", monospace',
              caretColor: 'var(--accent)',
            }}
            placeholder="Describe what this cron job should do..."
          />
        </div>
      </div>
    </div>
  )
}


function FieldGroup({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
      {children}
    </div>
  )
}


function FormField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-[0.1em] mb-1 block" style={{ color: 'var(--text-dim)' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-[12px] px-2 py-1.5 rounded border outline-none"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', color: 'var(--text)' }}
      />
    </div>
  )
}


function StatusBadge({ enabled, status }) {
  if (!enabled) return <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--warn) 15%, transparent)', color: 'var(--warn)' }}>paused</span>
  if (status === 'ok') return <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--ok) 15%, transparent)', color: 'var(--ok)' }}>ok</span>
  if (status === 'error') return <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in oklab, #ef4444 15%, transparent)', color: '#ef4444' }}>error</span>
  return <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in oklab, var(--text-dim) 15%, transparent)', color: 'var(--text-dim)' }}>pending</span>
}


function fmtRelTime(ts) {
  if (!ts) return '—'
  const date = new Date(ts)
  const now = Date.now()
  const diff = date.getTime() - now
  const abs = Math.abs(diff)
  const past = diff < 0

  if (abs < 60_000) return past ? 'just now' : 'in <1m'
  if (abs < 3600_000) {
    const m = Math.round(abs / 60_000)
    return past ? `${m}m ago` : `in ${m}m`
  }
  if (abs < 86400_000) {
    const h = Math.round(abs / 3600_000)
    return past ? `${h}h ago` : `in ${h}h`
  }
  const d = Math.round(abs / 86400_000)
  return past ? `${d}d ago` : `in ${d}d`
}
