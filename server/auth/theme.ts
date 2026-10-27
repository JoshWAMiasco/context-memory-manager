import "server-only";
import { eq } from "drizzle-orm";
import { DEFAULT_THEME, isThemePreference, type ThemePreference } from "@/lib/theme";
import { hashToken } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

/**
 * The theme a page renders in: the signed-in user's own (so a change made in another browser
 * applies here too), else the theme cookie the last sign-in left (the sign-in and lock pages),
 * else Dark. Never fails: a page always renders.
 *
 * @example
 * <html data-theme={readPageTheme(cookieStore.get(THEME_COOKIE_NAME)?.value, sessionToken)}>
 */
export function readPageTheme(themeCookie: string | undefined, sessionToken: string | undefined): ThemePreference {
  const cookieTheme = isThemePreference(themeCookie) ? themeCookie : DEFAULT_THEME;
  if (!sessionToken) return cookieTheme;
  try {
    const row = getDatabase()
      .orm.select({ theme: users.theme })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.idHash, hashToken(sessionToken)))
      .get();
    return row?.theme ?? cookieTheme;
  } catch {
    return cookieTheme;
  }
}
