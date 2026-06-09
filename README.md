# composable-agents-ext

Pi extension for the Composable Agents framework. Adds tools to run pipelines, validate agents, and inspect agent manifests.

## Install

```bash
# Install CLI globally (required)
npm install -g composable-agents-cli

# Install pi extension
pi install github:yourname/composable-agents-ext
```

## Tools

| Tool | What it does |
|------|-------------|
| `run-pipeline` | Execute a pipeline.yaml and stream JSON-line progress |
| `validate` | Check an agent.yaml for errors |
| `list-agents` | Find all agents in a directory |
| `inspect-agent` | Show an agent's manifest as JSON |

## Examples

The extension ships with an example agent-scaffolder at `examples/agent-scaffolder/`.

```
# In pi, inspect the example
Inspect the agent at ~/.extension-manager/extensions/composable-agents/examples/agent-scaffolder/agent.yaml
```

## Development

```bash
npm install
pi -e ./index.ts
```
