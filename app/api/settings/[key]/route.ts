import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi, type RouteParams } from "@/server/auth/guard";
import { getConfig } from "@/server/config";
import { notFound } from "@/server/http/api-error";
import { requirePasswordConfirm } from "@/server/security/password-confirm";
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

const putSettingBodySchema = z.object({ value: z.unknown(), password: z.string().max(1024).optional() });

/**
 * Changes a setting (admins). Turning terminals on for a server needs the admin's password: anyone
 * who can then open one gets a shell on that machine.
 */
export const PUT = withApi(
  async ({ params, body, auth, client }) => {
    const settingKey = readSettingKey(params);
    if (settingKey === "terminal.enabled" && body.value === true && getConfig().mode === "server") {
      await requirePasswordConfirm({ user: auth.user, password: body.password ?? "", ip: client.ip });
    }
    return NextResponse.json({ key: settingKey, value: setSetting(settingKey, body.value) });
  },
  { roles: ["admin"], body: putSettingBodySchema },
);
