import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { forbidden } from "@/server/http/api-error";
import { addInternalRoot, listRegisteredStorages, listStoragesFor } from "@/server/storage/roots";

/** The storages the user can open; `?scope=registry` (admins) lists every registered storage, plugged in or not. */
export const GET = withApi(({ auth, request }) => {
  if (request.nextUrl.searchParams.get("scope") !== "registry") {
    return NextResponse.json({ storages: listStoragesFor(auth.user) });
  }
  if (auth.user.role !== "admin") throw forbidden();
  return NextResponse.json({ storages: listRegisteredStorages() });
});

const addStorageBodySchema = z.object({
  path: z.string().min(1).max(4096),
  label: z.string().trim().min(1).max(80),
});

export const POST = withApi(
  async ({ auth, body }) => {
    const storageRow = await addInternalRoot(body.path, body.label, auth.user.id);
    const storage = listStoragesFor(auth.user).find((candidate) => candidate.id === storageRow.id);
    return NextResponse.json({ storage }, { status: 201 });
  },
  { roles: ["admin"], stepUp: { action: "storage-admin", resource: () => "storages" }, body: addStorageBodySchema },
);
