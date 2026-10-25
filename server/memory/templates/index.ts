import "server-only";
import type { MemoryTemplateSummary } from "@/lib/memory";
import { agentScratchpadTemplate } from "@/server/memory/templates/agent-scratchpad";
import { blankTemplate } from "@/server/memory/templates/blank";
import { llmPersonaTemplate } from "@/server/memory/templates/llm-persona";
import { projectKnowledgeTemplate } from "@/server/memory/templates/project-knowledge";
import type { MemoryTemplate } from "@/server/memory/templates/types";

/** Every memory template, in the order the dialog shows them. */
export const MEMORY_TEMPLATES: readonly MemoryTemplate[] = [
  blankTemplate,
  llmPersonaTemplate,
  projectKnowledgeTemplate,
  agentScratchpadTemplate,
];

export function findMemoryTemplate(templateId: string): MemoryTemplate | undefined {
  return MEMORY_TEMPLATES.find((template) => template.id === templateId);
}

/** The templates without their file contents, for the new-memory dialog. */
export function listMemoryTemplates(): MemoryTemplateSummary[] {
  return MEMORY_TEMPLATES.map(({ id, name, description, files }) => ({
    id,
    name,
    description,
    paths: files.map((file) => file.path),
  }));
}

export type { MemoryTemplate } from "@/server/memory/templates/types";
