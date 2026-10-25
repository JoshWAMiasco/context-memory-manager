import { withApi } from "@/server/auth/guard";
import { createEventStream } from "@/server/events/sse-stream";

/**
 * Server-sent events: `?topics=fs,drives,jobs` and repeatable `?watch=<storageId>:<path>` to
 * watch folders. A GET, so it never counts as activity for auto-lock.
 */
export const GET = withApi(
  async ({ request, auth, actor }) =>
    new Response(await createEventStream({ request, auth, actor }), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    }),
);
