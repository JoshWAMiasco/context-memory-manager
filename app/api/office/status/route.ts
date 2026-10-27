import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { detectLibreOffice } from "@/server/office/libreoffice";

/** Whether LibreOffice is installed, for Office previews. `?force=1` looks again now. */
export const GET = withApi(
  async ({ query }) => {
    const detection = await detectLibreOffice({ force: query.force === "1" });
    return NextResponse.json({ ...detection, path: undefined });
  },
  { query: z.object({ force: z.enum(["0", "1"]).optional() }) },
);
