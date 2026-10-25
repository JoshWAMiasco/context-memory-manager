import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi, type RouteInput } from "@/server/auth/guard";
import { removeStorage, updateStorage } from "@/server/storage/roots";

const storageStepUp = {
  action: "storage-admin" as const,
  resource: ({ params }: RouteInput) => `storages:${readRouteParameter(params, "id")}`,
};

const updateStorageBodySchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    hidden: z.boolean().optional(),
  })
  .refine((changes) => changes.label !== undefined || changes.hidden !== undefined, "Nothing to change.");

export const PATCH = withApi(
  ({ params, body }) => {
    const storageRow = updateStorage(readRouteParameter(params, "id"), body);
    return NextResponse.json({ storage: { id: storageRow.id, label: storageRow.label, hidden: storageRow.hidden } });
  },
  { roles: ["admin"], stepUp: storageStepUp, body: updateStorageBodySchema },
);

export const DELETE = withApi(
  ({ params }) => {
    removeStorage(readRouteParameter(params, "id"));
    return NextResponse.json({ ok: true });
  },
  { roles: ["admin"], stepUp: storageStepUp },
);
