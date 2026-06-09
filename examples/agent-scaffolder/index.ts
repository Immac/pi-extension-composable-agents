/**
 * Agent Scaffolder — creates new composable agents
 *
 * Input (blackboard):
 *   agent/name  — agent id (e.g., "my-agent")
 *   agent/type  — "llm" | "code" | "composite"
 *
 * Output:
 *   Creates agents/<name>/agent.yaml and agents/<name>/index.ts (or prompt.md)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default {
  async execute(scope: any) {
    const name = scope.cabinet.get('agent/name') as string;
    const type = (scope.cabinet.get('agent/type') as string) || 'code';

    if (!name) {
      return { status: 'failed' as const, error: 'No agent/name in cabinet' };
    }

    const dir = resolve(process.cwd(), 'agents', name);
    mkdirSync(dir, { recursive: true });

    // agent.yaml
    const yaml = type === 'llm'
      ? `id: ${name}\ntype: llm\nversion: 0.1.0\npurpose: "Describe what this agent does"\nllm:\n  prompt_template: ./prompt.md\n  model: opencode-go/deepseek4flash\n  temperature: 0.7\nlearning:\n  channels: []\n`
      : type === 'composite'
      ? `id: ${name}\ntype: composite\nversion: 0.1.0\npurpose: "Describe what this composite agent does"\npipeline: []\nlearning:\n  channels: []\n`
      : `id: ${name}\ntype: code\nversion: 0.1.0\npurpose: "Describe what this agent does"\ncode:\n  entrypoint: ./index.ts\nlearning:\n  channels: []\n`;

    writeFileSync(resolve(dir, 'agent.yaml'), yaml);

    // Implementation file
    if (type === 'llm') {
      writeFileSync(resolve(dir, 'prompt.md'), `You are ${name}.\n\nTask: {{task.input}}\n\nRespond to the task above.\n`);
    } else if (type === 'code') {
      writeFileSync(resolve(dir, 'index.ts'), `import type { ExecutionScope, AgentResult } from 'composable-agents';\n\nexport default {\n  async execute(scope: ExecutionScope): Promise<AgentResult> {\n    const input = scope.blackboard.task.input as string;\n    // TODO: implement logic\n    scope.blackboard.setTaskOutput(input);\n    return { status: 'success', output: input };\n  },\n};\n`);
    }

    const output = `Created ${type} agent "${name}" at agents/${name}/`;
    scope.blackboard.setTaskOutput(output);

    return { status: 'success' as const, output };
  },
};
