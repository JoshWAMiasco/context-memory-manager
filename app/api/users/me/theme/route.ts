import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildThemeCookie, THEME_PREFERENCES } from "@/lib/theme";
import { withApi } from "@/server/auth/guard";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

const themeBodySchema = z.object({ theme: z.enum(THEME_PREFERENCES) });

/** Saves the signed-in user's colour theme (it follows them to any browser) and mirrors it in the theme cookie. */
export const PUT = withApi(
  ({ auth, body, client }) => {
    getDatabase().orm.update(users).set({ theme: body.theme }).where(eq(users.id, auth.user.id)).run();
    const response = NextResponse.json({ theme: body.theme });
    response.cookies.set(buildThemeCookie(body.theme, client.isSecure));
    return response;
  },
  { body: themeBodySchema, allowPasswordChangeRequired: true },
);
