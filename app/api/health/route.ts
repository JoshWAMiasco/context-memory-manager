import { hash } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import type { HealthResponse } from "@/lib/api-types";
import packageManifest from "@/package.json";
import { withApi } from "@/server/auth/guard";
import { getDatabase } from "@/server/db/client";

async function canHashWithArgon2(): Promise<boolean> {
  try {
    const passwordHash = await hash("cmm-health-check", { memoryCost: 1024, timeCost: 1, parallelism: 1 });
    return passwordHash.startsWith("$argon2id$");
  } catch {
    return false;
  }
}

/** Public liveness check: proves the native SQLite and argon2 modules load. Polled by the desktop launcher. */
export const GET = withApi(
  async ({ config }) => {
    const { connection } = getDatabase();
    const { sqliteVersion } = connection.prepare("select sqlite_version() as sqliteVersion").get() as {
      sqliteVersion: string;
    };
    const body: HealthResponse = {
      ok: true,
      version: packageManifest.version,
      mode: config.mode,
      sqlite: sqliteVersion,
      argon2: await canHashWithArgon2(),
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  },
  { auth: false },
);
