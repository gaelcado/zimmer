# API Reference

Base path: `/api`

## Sessions

```
GET    /sessions
GET    /sessions/active
GET    /sessions/{id}
GET    /sessions/{id}/messages
GET    /sessions/{id}/tools
POST   /sessions/{id}/kill
PUT    /sessions/{id}/title
POST   /sessions/batch-rename/suggest
```

## Stats / Process

```
GET    /stats
GET    /processes
```

## Events / Streaming

```
GET    /events
GET    /events/history
GET    /events/active-tools
GET    /events/active-llm
WS     /terminal
```

## Logs

```
GET    /logs
GET    /logs/{filename}
```

## Context

```
GET    /context/soul
PUT    /context/soul
GET    /context/workspace
POST   /context/workspace/create
GET    /context/file?path=...
PUT    /context/file?path=...
GET    /context/memories
POST   /context/memories/create
PUT    /context/memories/{filename}
GET    /context/config
PUT    /context/config
GET    /context/skills
GET    /context/skills/{name}/content
POST   /context/skills/{name}/toggle
GET    /context/cron
GET    /context/cron/{id}
POST   /context/cron
PUT    /context/cron/{id}
DELETE /context/cron/{id}
POST   /context/cron/{id}/toggle
GET    /context/mcp/servers
PUT    /context/mcp/servers/{name}
DELETE /context/mcp/servers/{name}
```

## Workflows

```
GET    /workflows
GET    /workflows/auth
POST   /workflows
POST   /workflows/import
GET    /workflows/{id}
PUT    /workflows/{id}
GET    /workflows/{id}/export
GET    /workflows/{id}/validate
GET    /workflows/skills?platform=cli
POST   /workflows/{id}/run
GET    /workflows/runs
GET    /workflows/runs/metrics
POST   /workflows/runs/cleanup
GET    /workflows/runs/{run_id}
POST   /workflows/runs/{run_id}/cancel
```

## Honcho

```
GET    /honcho/status
GET    /honcho/config
PUT    /honcho/config
GET    /honcho/sessions
GET    /honcho/peers
GET    /honcho/peers/{id}
GET    /honcho/sessions/{id}/context
```
