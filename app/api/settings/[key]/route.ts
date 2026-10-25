import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi, type RouteParams } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { getSetting, isSettingKey, setSetting, type SettingKey } from "@/server/settings/store";

function readSettingKey(params: RouteParams): SettingKey {
  const settingKey = readRouteParameter(params, "key");
  if (!isSettingKey(settingKey)) throw notFound("Unknown setting.");
  return settingKey;
}

export const GET = withApi(({ params }) => {
  const settingKey = readSettingKey(params);
  return NextResponse.json({ key: settingKey, value: getSetting(settingKey) });
});

const putSettingBodySchema = z.object({ value: z.unknown() });

export const PUT = withApi(
  ({ params, body }) => {
    const settingKey = readSettingKey(params);
    return NextResponse.json({ key: settingKey, value: setSetting(settingKey, body.value) });
  },
  { roles: ["admin"], body: putSettingBodySchema },
);
