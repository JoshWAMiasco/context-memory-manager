import { NextResponse } from "next/server";
import { z } from "zod";
import { PROTECTION_MODES } from "@/lib/protection";
import { withApi } from "@/server/auth/guard";
import {
  storageFromBody,
  storageFromQuery,
  storagePathQuerySchema,
  storagePathSchema,
} from "@/server/http/fs-route-input";
import { readProtectionState, requestProtectionChange } from "@/server/protection";
import { requirePasswordConfirm } from "@/server/security/password-confirm";

/** The protection of a folder or file: effective and own mode, source, alert, busy. */
export const GET = withApi(
  async ({ query, storage }) => NextResponse.json(await readProtectionState(storage(query.storageId), query.path)),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);

const changeProtectionBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  mode: z.enum(PROTECTION_MODES),
  /** Required to remove "locked" (admins only). */
  password: z.string().max(1024).optional(),
});

/**
 * Sets None, View-only or Locked on a folder or file. Folders change through a
 * `protection.apply` job (`{ mode, job }`); files change at once (`{ mode }`).
 */
export const PUT = withApi(
  async ({ body, actor, auth, client, storage }) =>
    NextResponse.json(
      await requestProtectionChange({
        storage: storage(body.storageId),
        path: body.path,
        mode: body.mode,
        actor,
        confirmPassword:
          body.password === undefined
            ? undefined
            : () => requirePasswordConfirm({ user: auth.user, password: body.password ?? "", ip: client.ip }),
      }),
    ),
  { body: changeProtectionBodySchema, storageAccess: storageFromBody("write") },
);
