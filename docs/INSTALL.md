# Install, Update, Doctor

## Install

```bash
cd ~/.hermes/plugins/zimmer
./install.sh
```

`install.sh`:
- syncs gateway hook bridge files into `~/.hermes/hooks/zimmer_gateway_bridge`
- builds `ui/dist` when `npm` is available
- falls back to prebuilt `ui/dist` when `npm` is missing

## Update

```bash
cd ~/.hermes/plugins/zimmer
./update.sh
```

`update.sh`:
- pulls latest code (when installed from git)
- runs `install.sh`
- restarts `hermes-gateway.service` when active

## Doctor

```bash
cd ~/.hermes/plugins/zimmer
./doctor.sh
```

`doctor.sh` verifies:
- plugin manifest presence
- built UI assets
- deployed gateway hook files
- gateway service state and hook-load evidence (when systemd is available)

## Makefile shortcuts

```bash
cd ~/.hermes/plugins/zimmer
make install
make update
make doctor
make test
```

## Requirements

- Python `3.11+`
- Node `18+` (optional if `ui/dist` is already prebuilt)
- Hermes runtime dependencies (`fastapi`, `uvicorn`, `pyyaml`)

## Runtime configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ZIMMER_NO_BROWSER` | unset | Set to `1` to suppress browser auto-open on start |
| `ZIMMER_DISABLE_GATEWAY_HOOK_SYNC` | unset | Set to `1` to stop auto-syncing gateway hook files into `~/.hermes/hooks` |
| `ZIMMER_WORKFLOW_API_TOKEN` | unset | Shared token to protect workflow write/run endpoints |
| `ZIMMER_WORKFLOW_RUN_RETENTION_DAYS` | `7` | Days to keep run records |
| `ZIMMER_WORKFLOW_RUN_KEEP_PER_WORKFLOW` | `100` | Max runs to retain per workflow |
