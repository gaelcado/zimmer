import { HugeiconsIcon } from '@hugeicons/react'
import {
  ActivitySparkIcon, CommandLineIcon, FolderOpenIcon,
  ListViewIcon, BookOpen01Icon,
  Moon01Icon, Sun01Icon,
} from '@hugeicons/core-free-icons'
import Kbd from './Kbd.jsx'

const SCENES = [
  { key: 'monitor',  label: 'Monitor',  hotkey: '1', icon: ActivitySparkIcon },
  { key: 'terminal', label: 'Terminal', hotkey: '2', icon: CommandLineIcon },
  { key: 'context',  label: 'Context',  hotkey: '3', icon: FolderOpenIcon },
  { key: 'logs',     label: 'Logs',     hotkey: '4', icon: ListViewIcon },
]

export default function StatsBar({
  stats,
  processCount,
  connected,
  gatewayHealthy,
  honchoStatus,
  scene,
  onSceneChange,
  theme,
  onToggleTheme,
  onOpenAskDocs,
}) {
  const active = stats.active_sessions ?? 0
  const total = stats.total_sessions ?? 0
  const tokens = stats.total_tokens ?? 0
  const inputTokens = stats.total_input_tokens ?? 0
  const outputTokens = stats.total_output_tokens ?? 0
  const cacheTokens = (stats.total_cache_read_tokens ?? 0) + (stats.total_cache_write_tokens ?? 0)
  const reasoningTokens = stats.total_reasoning_tokens ?? 0
  const cost = stats.total_cost_usd ?? 0
  const gatewayTitle = connected
    ? 'Gateway: stream connected'
    : gatewayHealthy
      ? 'Gateway: backend reachable, stream reconnecting'
      : 'Gateway: unreachable'

  return (
    <div className="flex items-center justify-between px-4 h-11 border-b text-[11px]" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-3">
        <span className="zimmer-logo">Zimmer</span>
      </div>

      <div className="flex items-center gap-1" role="tablist" aria-label="Scenes">
        {SCENES.map((s) => {
          const isActive = scene === s.key
          return (
            <button
              key={s.key}
              onClick={() => onSceneChange(s.key)}
              role="tab"
              aria-selected={isActive}
              className="px-2.5 py-1 rounded text-[11px] transition-colors flex items-center gap-1.5"
              style={{
                background: isActive ? 'color-mix(in oklab, var(--accent) 16%, transparent)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-dim)',
              }}
              title={s.label + ' (' + s.hotkey + ')'}
            >
              <HugeiconsIcon icon={s.icon} size={12} color="currentColor" />
              {s.label}
            </button>
          )
        })}
        <button
          onClick={onOpenAskDocs}
          className="px-2.5 py-1 rounded text-[11px] transition-colors flex items-center gap-1.5"
          style={{ color: 'var(--text-dim)' }}
          title="Ask Docs (5)"
        >
          <HugeiconsIcon icon={BookOpen01Icon} size={12} color="currentColor" />
          Ask Docs
        </button>
      </div>

      <div className="flex items-center gap-4">
        <Stat label="sessions" value={String(active) + '/' + String(total)} highlight={active > 0} />
        <Stat label="tokens" value={fmtNum(tokens)} />
        {(inputTokens > 0 || outputTokens > 0) && (
          <Stat label="i/o" value={`${fmtNum(inputTokens)}/${fmtNum(outputTokens)}`} />
        )}
        {cacheTokens > 0 && <Stat label="cache" value={fmtNum(cacheTokens)} />}
        {reasoningTokens > 0 && <Stat label="reason" value={fmtNum(reasoningTokens)} />}
        <Stat label="cost" value={'$' + cost.toFixed(4)} />
        <span className="flex items-center gap-1.5" title={gatewayTitle}>
          <span className={connected ? 'w-1.5 h-1.5 rounded-full pulse-dot' : 'w-1.5 h-1.5 rounded-full'} style={{ background: connected ? 'var(--ok)' : gatewayHealthy ? 'var(--warn)' : 'var(--text-dim)' }} />
          <span style={{ color: 'var(--text-dim)' }}>gateway</span>
        </span>
        {honchoStatus?.enabled && (
          <span className="flex items-center gap-1.5" title={'Honcho: ' + (honchoStatus.recall_mode || 'hybrid') + ' mode · ' + (honchoStatus.peer_name || 'unnamed')}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ok)' }} />
            <span style={{ color: 'var(--text-dim)' }}>honcho</span>
          </span>
        )}
        <a
          href="https://github.com/gaelcado/zimmer"
          target="_blank"
          rel="noreferrer"
          className="px-1.5 py-0.5 rounded flex items-center"
          style={{ color: 'var(--text-dim)' }}
          title="View on GitHub"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
          </svg>
        </a>
        <button
          onClick={onToggleTheme}
          className="px-1.5 py-0.5 rounded flex items-center gap-1"
          style={{ color: 'var(--text-dim)' }}
          title="Toggle theme (T)"
        >
          <HugeiconsIcon icon={theme === 'dark' ? Moon01Icon : Sun01Icon} size={14} color="currentColor" />
          <Kbd keys="T" size="xs" />
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }) {
  return (
    <span>
      <span style={{ color: 'var(--text-dim)' }}>{label} </span>
      <span style={{ color: highlight ? 'var(--ok)' : 'var(--text)' }}>{value}</span>
    </span>
  )
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
