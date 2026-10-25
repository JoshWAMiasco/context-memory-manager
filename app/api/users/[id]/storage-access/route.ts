import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { listUserStorageAccess, setUserStorageAccess } from "@/server/storage/roots";

export const GET = withApi(
  ({ params }) => NextResponse.json({ access: listUserStorageAccess(readRouteParameter(params, "id")) }),
  {
    roles: ["admin"],
  },
);

const setUserAccessBodySchema = z.object({
  grants: z.array(z.object({ storageId: z.string().min(1), level: z.enum(["none", "read", "write"]) })).max(1000),
});

export const PUT = withApi(
  ({ params, body }) =>
    NextResponse.json({ access: setUserStorageAccess(readRouteParameter(params, "id"), body.grants) }),
  {
    roles: ["admin"],
    stepUp: { action: "user-admin", resource: ({ params }) => `users:${readRouteParameter(params, "id")}` },
    body: setUserAccessBodySchema,
  },
);
