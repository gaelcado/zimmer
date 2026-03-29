# Hermes Zimmer

<p align="center">
  <img src="./zimmer.png" alt="Zimmer poster for Hermes Agent" />
</p>

<p align="center">
  Real-time monitoring UI for
  <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a>.
</p>

Zimmer lives entirely as a plugin under `~/.hermes/plugins/zimmer` and adds:
- live monitor + timeline
- in-app terminal view
- context/config/skills/cron editors
- gateway hook bridge for richer messaging/gateway telemetry

## Quick start

```bash
cd ~/.hermes/plugins/zimmer
./install.sh
./doctor.sh
```

Or with make:

```bash
make install
make doctor
```

## Docs

- [Install / Update / Doctor](./docs/INSTALL.md)
- [Usage Guide (Scenes, Shortcuts, Live Signals)](./docs/USAGE.md)
- [API Reference](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Development](./docs/DEVELOPMENT.md)

## Maintenance commands

```bash
make install
make update
make doctor
make test
make ui-build
make ui-dev
```

## License

Part of the Hermes Agent ecosystem by Nous Research.
