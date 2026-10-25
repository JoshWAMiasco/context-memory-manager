import "server-only";
import type { MemoryTemplate } from "@/server/memory/templates/types";

export const agentScratchpadTemplate: MemoryTemplate = {
  id: "agent-scratchpad",
  name: "Agent scratchpad",
  description: "Working space for an agent: its task list, what it found, and throwaway notes.",
  files: [
    {
      path: "tasks.md",
      content: `# Tasks

> Tip: keep this list current; tick items off instead of deleting them.

- [ ] 
`,
    },
    {
      path: "findings.md",
      content: `# Findings

> Tip: what the agent learned, with where it came from (file, link, command).

## 
`,
    },
    { path: "scratch/", content: "" },
  ],
};
