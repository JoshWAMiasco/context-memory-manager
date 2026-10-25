import { NextResponse } from "next/server";
import { z } from "zod";
import { USER_ROLES } from "@/lib/auth/policy";
import { readRouteParameter, withApi, type RouteInput } from "@/server/auth/guard";
import { deleteUser, resetUserPassword, updateUser } from "@/server/auth/users";

const userStepUp = {
  action: "user-admin" as const,
  resource: ({ params }: RouteInput) => `users:${readRouteParameter(params, "id")}`,
};

const updateUserBodySchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    disabled: z.boolean().optional(),
    temporaryPassword: z.string().optional(),
  })
  .refine((update) => Object.values(update).some((updateValue) => updateValue !== undefined), "Nothing to change.");

/** Changes a user's role or disabled flag, or sets a temporary password (`temporaryPassword`). */
export const PATCH = withApi(
  async ({ body, params }) => {
    const userId = readRouteParameter(params, "id");
    let user = body.role !== undefined || body.disabled !== undefined ? updateUser(userId, body) : undefined;
    if (body.temporaryPassword !== undefined) user = await resetUserPassword(userId, body.temporaryPassword);
    return NextResponse.json({ user });
  },
  { roles: ["admin"], stepUp: userStepUp, body: updateUserBodySchema },
);

export const DELETE = withApi(
  ({ params }) => {
    deleteUser(readRouteParameter(params, "id"));
    return NextResponse.json({ ok: true });
  },
  { roles: ["admin"], stepUp: userStepUp },
);
