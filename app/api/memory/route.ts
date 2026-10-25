import { NextResponse } from "next/server";
import { z } from "zod";
import { MEMORY_COLORS, MEMORY_ICONS } from "@/lib/memory";
import { withApi } from "@/server/auth/guard";
import {
  storageFromBody,
  storageFromQuery,
  storagePathQuerySchema,
  storagePathSchema,
} from "@/server/http/fs-route-input";
import { createMemory, readMemory, updateMemory } from "@/server/memory";

const memoryFieldsSchema = {
  name: z.string().trim().min(1, "Enter a name.").max(120),
  description: z.string().max(2000).optional(),
  icon: z.enum(MEMORY_ICONS).optional(),
  color: z.enum(MEMORY_COLORS).optional(),
};

/** A folder's memory settings: `{ memory }`, or `{ memory: null }` for a plain folder. */
export const GET = withApi(
  async ({ query, storage }) =>
    NextResponse.json({ memory: (await readMemory(storage(query.storageId), query.path)) ?? null }),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);

const createMemoryBodySchema = z.object({
  storageId: z.string().min(1),
  parentPath: storagePathSchema,
  folderName: z.string().max(255).optional(),
  template: z.string().max(64).optional(),
  ...memoryFieldsSchema,
});

/** Creates a memory folder from a template. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(await createMemory(storage(body.storageId), body.parentPath, body, actor), { status: 201 }),
  { body: createMemoryBodySchema, storageAccess: storageFromBody("write") },
);

const updateMemoryBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  name: memoryFieldsSchema.name.optional(),
  description: memoryFieldsSchema.description,
  icon: memoryFieldsSchema.icon,
  color: memoryFieldsSchema.color,
});

/** Changes a memory's name, description, icon or colour. */
export const PATCH = withApi(
  async ({ body: { storageId, path, ...patch }, storage }) =>
    NextResponse.json({ memory: await updateMemory(storage(storageId), path, patch) }),
  { body: updateMemoryBodySchema, storageAccess: storageFromBody("write") },
);
