import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { listMemoryTemplates } from "@/server/memory/templates";

/** The memory templates, with the paths each creates. */
export const GET = withApi(() => NextResponse.json({ templates: listMemoryTemplates() }));
