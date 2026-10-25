import "server-only";

/** A starting layout for a new memory. Paths ending in "/" are folders. */
export interface MemoryTemplate {
  id: string;
  name: string;
  description: string;
  files: { path: string; content: string }[];
}
