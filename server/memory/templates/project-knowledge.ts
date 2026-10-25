import "server-only";
import type { MemoryTemplate } from "@/server/memory/templates/types";

export const projectKnowledgeTemplate: MemoryTemplate = {
  id: "project-knowledge",
  name: "Project knowledge",
  description: "What a project is, the decisions made along the way, and the words it uses.",
  files: [
    {
      path: "overview.md",
      content: `# Overview

> Tip: what the project is for, who uses it, and where its code and documents live.

## Goal

## Users

## Where things are
`,
    },
    {
      path: "decisions.md",
      content: `# Decisions

> Tip: one heading per decision, newest first: what was decided, why, and what was ruled out.

## YYYY-MM-DD: Decision title

**Decision:**

**Why:**

**Alternatives considered:**
`,
    },
    {
      path: "glossary.md",
      content: `# Glossary

> Tip: terms the project uses, in alphabetical order.

| Term | Meaning |
| --- | --- |
|  |  |
`,
    },
    { path: "notes/", content: "" },
  ],
};
