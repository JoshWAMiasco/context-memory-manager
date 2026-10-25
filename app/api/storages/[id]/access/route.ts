import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { listStorageAccess, setStorageAccess } from "@/server/storage/roots";

export const GET = withApi(
  ({ params }) => NextResponse.json({ access: listStorageAccess(readRouteParameter(params, "id")) }),
  {
    roles: ["admin"],
  },
);

const setAccessBodySchema = z.object({
  grants: z.array(z.object({ userId: z.string().min(1), level: z.enum(["none", "read", "write"]) })).max(1000),
});

export const PUT = withApi(
  ({ params, body }) => NextResponse.json({ access: setStorageAccess(readRouteParameter(params, "id"), body.grants) }),
  {
    roles: ["admin"],
    stepUp: { action: "storage-admin", resource: ({ params }) => `storages:${readRouteParameter(params, "id")}` },
    body: setAccessBodySchema,
  },
);
