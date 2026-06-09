# 🔧 Composable Agents Pi Extension

Pi extension for the [Composable Agents](https://github.com/Immac/composable-agents) framework. Run pipelines, validate agents, and inspect agent manifests directly from your pi session.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)
![MIT License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Pi Extension](https://img.shields.io/badge/pi--extension-orange?style=flat-square)

## ✨ Features

- 🔍 **Validate agents** — catch schema errors, missing fields, bad types before running
- 📋 **List agents** — scan directories for all agent.yaml files with validation status
- 🔎 **Inspect agents** — view full agent manifests as structured JSON
- ▶️ **Run pipelines** — execute pipeline.yaml files with real-time streaming output
- 📦 **Example agents** — ships with agent-scaffolder to learn the pattern

## 📦 Tools

| Tool | Description |
|---|---|
| `run-pipeline` | Execute a pipeline.yaml and stream JSON-line progress |
| `validate` | Check an agent.yaml for schema errors |
| `list-agents` | Find all agent.yaml files in a directory |
| `inspect-agent` | Load and return an agent's manifest as JSON |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Pi coding agent installed

### Install

```bash
# Install CLI globally (required)
npm install -g composable-agents-cli

# Install pi extension
pi install github:Immac/pi-extension-composable-agents
```

### First Use

Restart pi, then:

```
List agents in ./agents/
```

The LLM will automatically use the `list-agents` tool to find and validate all agents.

## 💡 Usage Examples

### Validate an agent

```
Validate the agent at ./agents/echo/agent.yaml
```

### Inspect an agent

```
Show me the manifest for ./agents/my-agent/agent.yaml
```

### Run a pipeline

```
Run the pipeline at ./pipelines/deploy.yaml
```

### Learn from examples

```
Inspect the agent-scaffolder example at ~/.extension-manager/extensions/composable-agents/examples/agent-scaffolder/agent.yaml
```

## 📂 Examples

The extension ships with an example **agent-scaffolder** — a code agent that creates new agents from a name and type.

```
examples/
├── agent-scaffolder/
│   ├── agent.yaml      # Agent declaration
│   └── index.ts        # Creates agent.yaml + implementation files
└── pipelines/
    └── scaffold-agent.yaml  # Example pipeline
```

### What it demonstrates

- How agents declare inputs/outputs via cabinet keys
- How code agents read from `scope.blackboard` and `scope.cabinet`
- How to create agent.yaml and implementation files programmatically

## 🔧 How It Works

Each tool spawns the `composable-agents` CLI as a child process and reads JSON lines from stdout:

```
pi TUI
  └── composable-agents extension
        ├── run-pipeline    → composable-agents run <path>
        ├── validate        → composable-agents validate <path>
        ├── list-agents     → find + composable-agents validate
        └── inspect-agent   → composable-agents inspect <path>
```

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone git@github.com:Immac/pi-extension-composable-agents.git
cd pi-extension-composable-agents
npm install
```

### Validate

```bash
npx tsc --noEmit
```

### Test Locally

```bash
pi -e ./index.ts
```

## 📄 License

MIT
