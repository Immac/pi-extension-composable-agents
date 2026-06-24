/**
 * Agent Scaffolder — creates new composable agents
 *
 * Input (blackboard):
 *   agent/name  — agent id (e.g., "my-agent")
 *   agent/type  — "llm" | "code" | "composite"
 *
 * Output:
 *   Creates agents/<name>/agent.json and agents/<name>/index.ts (or prompt.md)
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

    // agent.json (JSON-serialized agent manifest, valid YAML superset)
    const manifest = {
      id: name,
      type,
      version: '0.1.0',
      purpose: 'Describe what this agent does',
      ...(type === 'llm'
        ? { llm: { prompt_template: './prompt.md', model: 'opencode-go/deepseek4flash', temperature: 0.7 } }
        : type === 'composite'
        ? { pipeline: [] }
        : { code: { entrypoint: './index.ts' } }),
      learning: { channels: [] },
    };

    writeFileSync(resolve(dir, 'agent.json'), JSON.stringify(manifest, null, 2));

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
