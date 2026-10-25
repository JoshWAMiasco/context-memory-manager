import "server-only";
import type { MemoryTemplate } from "@/server/memory/templates/types";

export const blankTemplate: MemoryTemplate = {
  id: "blank",
  name: "Blank",
  description: "An empty memory. Add whatever files your tools need.",
  files: [],
};
