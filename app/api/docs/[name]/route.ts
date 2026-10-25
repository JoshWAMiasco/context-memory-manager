import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDF_GUIDES, isPdfGuideName } from "@/lib/pdf-guides";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";

/**
 * `GET /api/docs/desktop-guide` or `/server-guide`: the bundled PDF guide, shown in the
 * browser's PDF viewer. The entry sets `CMM_DOCS_DIR` to the folder next to the app that holds them.
 */
export const GET = withApi(async ({ params }) => {
  const guideName = readRouteParameter(params, "name");
  if (!isPdfGuideName(guideName)) throw notFound("There is no such guide.");
  const guide = PDF_GUIDES[guideName];
  const guidesDirectory = process.env.CMM_DOCS_DIR;
  if (!guidesDirectory) throw notFound("The guides aren't included in this build.");
  // The ignore comment keeps Turbopack's file tracer from matching this runtime path across the project.
  // eslint-disable-next-line no-inline-comments
  const guidePath = path.join(/* turbopackIgnore: true */ guidesDirectory, guide.fileName);
  let pdfBytes: Buffer;
  try {
    pdfBytes = await readFile(guidePath);
  } catch {
    throw notFound("The guides aren't included in this build.");
  }
  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${guide.fileName}"`,
      "content-length": String(pdfBytes.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
