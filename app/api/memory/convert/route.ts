import { NextResponse } from "next/server";
import { z } from "zod";
import { MEMORY_COLORS, MEMORY_ICONS } from "@/lib/memory";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { convertToFolder, convertToMemory } from "@/server/memory";
import { forgetMemory } from "@/server/memory/discovery";

const convertBodySchema = z.discriminatedUnion("to", [
  z.object({
    storageId: z.string().min(1),
    path: storagePathSchema,
    to: z.literal("memory"),
    name: z.string().trim().min(1, "Enter a name.").max(120),
    description: z.string().max(2000).optional(),
    icon: z.enum(MEMORY_ICONS).optional(),
    color: z.enum(MEMORY_COLORS).optional(),
  }),
  z.object({ storageId: z.string().min(1), path: storagePathSchema, to: z.literal("folder") }),
]);

/** Turns a folder into a memory, or a memory back into a folder; the contents stay. */
export const POST = withApi(
  async ({ body, storage }) => {
    if (body.to === "folder") {
      await convertToFolder(storage(body.storageId), body.path);
      forgetMemory(body.storageId, body.path);
      return NextResponse.json({ memory: null });
    }
    const { name, description, icon, color } = body;
    return NextResponse.json({
      memory: await convertToMemory(storage(body.storageId), body.path, { name, description, icon, color }),
    });
  },
  { body: convertBodySchema, storageAccess: storageFromBody("write") },
);
