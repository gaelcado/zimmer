# Usage Guide

## Scenes

| # | Scene | Hotkey | Description |
|---|-------|--------|-------------|
| 1 | **Monitor** | `1` | Session list/tree, turns, messages, live tool activity |
| 2 | **Terminal** | `2` | In-app PTY shell over WebSocket |
| 3 | **Context** | `3` | Soul, Workspace, Memories, Honcho, Config, Skills, Cron editors |
| 4 | **Logs** | `4` | `~/.hermes/logs` browser with tail controls |
| 5 | **Ask Docs** | `5` | Opens DeepWiki for Hermes Agent in a new tab |

`Tab` cycles scenes.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `1` – `5` | Jump to scene (5 opens external docs) |
| `Tab` | Cycle scenes |
| `v` | Toggle monitor view (List / Tree) |
| `f` | Toggle lineage focus mode |
| `m` | Toggle Turns / Messages panel |
| `j` / `k` or `↑` / `↓` | Move session selection |
| `t` | Toggle theme |
| `Ctrl+K` or `Ctrl+Shift+P` | Open command palette |
| `Ctrl+S` | Save in editors |

## Monitor

### Live activity signals

| Signal | Source | Fallback |
|--------|--------|----------|
| Active tool calls | Plugin hook stream | DB-based inflight inference |
| LLM activity | `llm_start` / `llm_end` hook events | `GET /api/events/active-llm` |
| Permission requests | Terminal `approval_required` tool results (inferred in `post_tool_call`) | — |
| Permission resolution | Gateway hook bridge (`command:approve` / `command:deny`) | — |
| Queue depth | Gateway hook bridge (`command:queue` + `agent:start` dequeue approximation) | DB activity indicators |

Zimmer installs a gateway hook companion at `~/.hermes/hooks/zimmer_gateway_bridge`.

### Message roles

| Role | Badge | Rendering |
|------|-------|-----------|
| `assistant` | `AI` | Markdown |
| `user` | `USER` | Plain text |
| `system` | `SYS` | Plain text |
| `tool` | `TOOL` | Plain text |
| `summary` | `SUM` | Markdown |
| `compressed` | `CMP` | Context compression banner |

## Context scene

| Tab | Path |
|-----|------|
| **Soul** | `~/.hermes/SOUL.md` |
| **Workspace** | `AGENTS.md`, `.hermes.md`, `HERMES.md`, `CLAUDE.md`, `.cursorrules` |
| **Memories** | `~/.hermes/memories/*.md` |
| **Honcho** | Status, config, session, peer helpers |
| **Config** | `~/.hermes/config.yaml` |
| **Skills** | Installed skills list + enable/disable |
| **Cron** | `~/.hermes/cron/jobs.json` |
| **MCP** | `mcp_servers:` in `~/.hermes/config.yaml` |

## Logs scene

- Lists files under `~/.hermes/logs`
- Tail sizes: 200 / 800 / 2000
- Auto-refresh every ~3s
