import "server-only";
import type { MemoryTemplate } from "@/server/memory/templates/types";

export const llmPersonaTemplate: MemoryTemplate = {
  id: "llm-persona",
  name: "LLM persona",
  description: "Who the assistant is, what it knows about you, and notes from past sessions.",
  files: [
    {
      path: "identity.md",
      content: `# Identity

> Tip: describe the assistant in a few lines: its role, tone and the things it must never do.

## Role

## Tone and style

## Boundaries
`,
    },
    {
      path: "facts.md",
      content: `# Facts

> Tip: one fact per line, with the date you learned it, so old facts can be checked.

- 
`,
    },
    {
      path: "preferences.md",
      content: `# Preferences

> Tip: how you like answers: length, format, language, tools to use or avoid.

## Answers

## Code

## Writing
`,
    },
    { path: "sessions/", content: "" },
  ],
};
