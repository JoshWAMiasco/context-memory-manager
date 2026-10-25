import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import {
  buildContentDisposition,
  readQueryFileResource,
  storageFromQuery,
  storagePathQuerySchema,
  toResponseBody,
} from "@/server/http/fs-route-input";
import { resolveInStorage } from "@/server/security/path-jail";
import { openFileReadStream } from "@/server/storage/fs-ops";
import { createFolderZipStream } from "@/server/storage/zip-download";

const downloadQuerySchema = storagePathQuerySchema.extend({
  /** "1": an encrypted file as stored (ciphertext) instead of decrypted. */
  raw: z.enum(["0", "1"]).optional(),
});

/**
 * Downloads a file as an attachment, or a folder as a zip. Needs the `download` step-up; browsers
 * pass the action token as `?at=` (see `getStepUpDownloadUrl`). Files in an encrypted folder come
 * decrypted (the folder must be unlocked), or with `raw=1` exactly as stored.
 */
export const GET = withApi(
  async ({ query, actor, storage }) => {
    const activeStorage = storage(query.storageId);
    const resolvedPath = await resolveInStorage(activeStorage, query.path);
    const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if ((await stat(resolvedPath.absolutePath)).isDirectory()) {
      const folderName =
        resolvedPath.relativePath === "" ? activeStorage.label : path.basename(resolvedPath.absolutePath);
      headers["content-type"] = "application/zip";
      headers["content-disposition"] = buildContentDisposition("attachment", `${folderName}.zip`);
      const zipStream = await createFolderZipStream(activeStorage, resolvedPath.relativePath, actor);
      return new Response(toResponseBody(zipStream), { headers });
    }
    const asStored = query.raw === "1";
    const fileStream = await openFileReadStream(activeStorage, resolvedPath.relativePath, actor, { asStored });
    headers["content-type"] = "application/octet-stream";
    headers["content-disposition"] = buildContentDisposition(
      "attachment",
      asStored ? `${fileStream.fileName}.cmm1` : fileStream.fileName,
    );
    headers["content-length"] = String(fileStream.size);
    return new Response(toResponseBody(fileStream.stream), { headers });
  },
  {
    query: downloadQuerySchema,
    storageAccess: storageFromQuery("read"),
    stepUp: { action: "download", resource: readQueryFileResource },
  },
);
