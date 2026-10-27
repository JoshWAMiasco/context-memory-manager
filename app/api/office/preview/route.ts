import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema, toResponseBody } from "@/server/http/fs-route-input";
import { convertOfficeFileToPdf } from "@/server/office/libreoffice";

/**
 * An Office file (pptx, doc, xls, ppt, OpenDocument, RTF) as a PDF, converted by LibreOffice and
 * cached. Sandboxed like the raw view. Files in an encrypted folder are refused.
 */
export const GET = withApi(
  async ({ query, actor, storage }) => {
    const pdfPath = await convertOfficeFileToPdf(storage(query.storageId), query.path, actor);
    const { size } = await stat(pdfPath);
    return new Response(toResponseBody(createReadStream(pdfPath)), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(size),
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, no-cache",
      },
    });
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
