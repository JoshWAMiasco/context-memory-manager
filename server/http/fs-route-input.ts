import "server-only";
import { Readable } from "node:stream";
import { z } from "zod";
import type { StorageAccessLevel } from "@/lib/api-types";
import type { RouteInput, StorageAccessRequirement } from "@/server/auth/guard";

export const MAX_PATH_LENGTH = 4096;

export const storagePathSchema = z.string().max(MAX_PATH_LENGTH).default("");

/** `?storageId=&path=` on GET file routes. */
export const storagePathQuerySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
});

export const storagePathReferenceSchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
});

function readObjectField(value: unknown, fieldName: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[fieldName] : undefined;
}

/** `storageAccess` for routes that name the storage in the query (`?storageId=`). */
export function storageFromQuery(level: StorageAccessLevel) {
  return ({ searchParams }: RouteInput): StorageAccessRequirement => ({
    storageId: searchParams.get("storageId"),
    level,
  });
}

/** `storageAccess` for routes that name the storage in the JSON body (`{ storageId }`). */
export function storageFromBody(level: StorageAccessLevel) {
  return ({ rawBody }: RouteInput): StorageAccessRequirement => ({
    storageId: readObjectField(rawBody, "storageId"),
    level,
  });
}

/** `storageAccess` for move and copy: every source at `sourceLevel`, the destination at write. */
export function storagesOfTransfer(sourceLevel: StorageAccessLevel) {
  return ({ rawBody }: RouteInput): StorageAccessRequirement[] => {
    const sources = readObjectField(rawBody, "sources");
    const sourceRequirements = Array.isArray(sources)
      ? sources.map((source) => ({ storageId: readObjectField(source, "storageId"), level: sourceLevel }))
      : [];
    return [
      ...sourceRequirements,
      { storageId: readObjectField(readObjectField(rawBody, "destination"), "storageId"), level: "write" },
    ];
  };
}

/** The step-up resource of a file: `<storageId>:<path>`, the same string the client confirms. */
export function readQueryFileResource({ searchParams }: RouteInput): string {
  return `${searchParams.get("storageId") ?? ""}:${searchParams.get("path") ?? ""}`;
}

/** A `Content-Disposition` value that keeps non-ASCII names (RFC 6266) with an ASCII fallback. */
export function buildContentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiName = fileName.replaceAll(/[^\u0020-\u007E]/g, "_").replaceAll(/["\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** A Node stream as a fetch `Response` body. */
export function toResponseBody(nodeStream: Readable): ReadableStream<Uint8Array> {
  const chunks = nodeStream[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(typeof value === "string" ? Buffer.from(value) : value);
        } catch (readError) {
          controller.error(readError);
        }
      },
      async cancel() {
        nodeStream.destroy();
        await chunks.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}
