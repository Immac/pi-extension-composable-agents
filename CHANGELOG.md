# Changelog

## [0.2.0] — 2026-06-24

### Changed (breaking)

- **Agent format: YAML → JSON** — All agent declarations now use `agent.json` instead of `agent.yaml`. The upstream `composable-agents` core library's `loadAgent()` auto-detects both formats, and JSON is the canonical format going forward.
- **Pipeline format: YAML → JSON** — Pipeline files now use `.json` extension. JSON is valid YAML (YAML is a superset of JSON), so the upstream `loadPipelineYaml()` parser handles it without changes.
- **Code/tool descriptions** — All `agent.yaml`/`agent.toml`/`pipeline.yaml` references updated to `agent.json`/`pipeline.json`.

### Added

- **CHANGELOG.md** — This file tracks versions and breaking changes.
- **Version bump** — `0.1.0` → `0.2.0` to signal the agent file format change.
- **`@types/node` dev dependency** — For type-safe Node.js API usage.

### Fixed

- **agent-scaffolder example** — Now generates `agent.json` (JSON-formatted) instead of `agent.yaml`.
- **Internal consistency** — All tool descriptions, prompt guidelines, and parameter docs use the correct file extensions.

## [0.1.0] — 2026-06-?

### Added

- Initial release — composable-agents pi extension with tools for running pipelines, validating agents, listing agents, and inspecting agent manifests.
- Examples: `agent-scaffolder` code agent and a `scaffold-agent` pipeline.
