import { NextResponse } from "next/server";
import { z } from "zod";
import { USER_ROLES } from "@/lib/auth/policy";
import { withApi } from "@/server/auth/guard";
import { createUser, listUsers } from "@/server/auth/users";

export const GET = withApi(() => NextResponse.json({ users: listUsers() }), { roles: ["admin"] });

const createUserBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  role: z.enum(USER_ROLES),
});

export const POST = withApi(async ({ body }) => NextResponse.json({ user: await createUser(body) }, { status: 201 }), {
  roles: ["admin"],
  stepUp: { action: "user-admin", resource: () => "users" },
  body: createUserBodySchema,
});
