import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { dismissProtectionAlert } from "@/server/protection";

const dismissBodySchema = z.object({ storageId: z.string().min(1), path: storagePathSchema });

/** Dismisses a folder's "modified by another program" alert. */
export const DELETE = withApi(
  async ({ body, storage }) => {
    await dismissProtectionAlert(storage(body.storageId), body.path);
    return NextResponse.json({ ok: true });
  },
  { body: dismissBodySchema, storageAccess: storageFromBody("write") },
);
