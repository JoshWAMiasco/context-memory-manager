import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";

/**
 * The offline "How to install Git" notes, from `content/help/git-install.md`. The entry
 * sets `CMM_CONTENT_DIR` (the source tree in development, `dist/app/content` when packaged), so
 * Next's file tracing never has to follow a computed path.
 */
export const GET = withApi(async () => {
  const contentDirectory = process.env.CMM_CONTENT_DIR;
  if (!contentDirectory) throw notFound("The help texts aren't available.");
  // The ignore comment keeps Turbopack's file tracer from matching this runtime path across the project.
  // eslint-disable-next-line no-inline-comments
  const helpPath = path.join(/* turbopackIgnore: true */ contentDirectory, "help", "git-install.md");
  const markdown = await readFile(helpPath, "utf8");
  return NextResponse.json({ markdown });
});
