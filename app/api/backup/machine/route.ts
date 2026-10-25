import { statfs } from "node:fs/promises";
import { hostname } from "node:os";
import { NextResponse } from "next/server";
import type { BackupMachine } from "@/lib/api-types";
import { withApi } from "@/server/auth/guard";
import { findActiveStorage, listStoragesFor } from "@/server/storage/roots";

/**
 * The computer in the middle of the Backup page's topology: its name, whether CCM runs as a
 * desktop app or a server, and the capacity of the internal storages this user can open.
 */
export const GET = withApi(async ({ config, actor }) => {
  const storages: BackupMachine["storages"] = [];
  for (const summary of listStoragesFor(actor)) {
    if (summary.kind !== "internal") continue;
    const rootPath = findActiveStorage(summary.id)?.rootPath;
    const fileSystem = rootPath ? await statfs(rootPath).catch(() => undefined) : undefined;
    if (!fileSystem) continue;
    const size = Number(fileSystem.blocks) * Number(fileSystem.bsize);
    storages.push({
      storageId: summary.id,
      label: summary.label,
      size,
      used: size - Number(fileSystem.bfree) * Number(fileSystem.bsize),
    });
  }
  const machine: BackupMachine = { hostname: hostname(), mode: config.mode, storages };
  return NextResponse.json(machine);
});
