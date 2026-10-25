"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";
import { useState } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { Button } from "@/components/primitives/button";
import { FormSwitch } from "@/components/primitives/form-check";
import { FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { ApiError, requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";

/**
 * Settings › Security › Terminals: whether admins may open terminals in folders. On a server,
 * turning them on asks for the admin's password first, since a terminal is a shell on that machine.
 *
 * @example
 * <TerminalSettingPanel initialValue={false} needsPasswordToEnable />
 */
export function TerminalSettingPanel({
  initialValue,
  needsPasswordToEnable,
}: {
  initialValue: boolean;
  needsPasswordToEnable: boolean;
}) {
  const queryClient = useQueryClient();
  const [isOn, setIsOn] = useState(initialValue);
  const [isAskingPassword, setIsAskingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const save = async (nextValue: boolean, confirmPassword?: string) => {
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson("/api/settings/terminal.enabled", {
        method: "PUT",
        body: { value: nextValue, password: confirmPassword },
      });
      setIsOn(nextValue);
      setIsAskingPassword(false);
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.terminals() });
      showToastNotification({
        title: nextValue ? "Terminals turned on" : "Terminals turned off",
        icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" />,
      });
    } catch (saveError) {
      setErrorMessage(saveError instanceof ApiError ? saveError.message : "Saving failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsPanel title="Terminals">
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <FormSwitch
        id="setting-terminal-enabled"
        label="Let admins open terminals in folders"
        description="A terminal runs commands, Claude Code and other command-line tools in a folder, as the user CMM runs as. It can read and change anything that user can, including files CMM protects. Only admins can open terminals."
        checked={isOn || isAskingPassword}
        disabled={isSaving}
        onChange={(changeEvent) => {
          const nextValue = changeEvent.target.checked;
          if (nextValue && needsPasswordToEnable) {
            setIsAskingPassword(true);
            return;
          }
          setIsAskingPassword(false);
          void save(nextValue);
        }}
      />
      {isAskingPassword && (
        <form
          className="mt-4 grid max-w-sm gap-1.5"
          data-testid="terminal-setting-password"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void save(true, password);
          }}
        >
          <FormLabel htmlFor="terminal-setting-password">Your password</FormLabel>
          <PasswordInput
            id="terminal-setting-password"
            value={password}
            autoComplete="current-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
          <FormHelpText>
            Anyone who can open a terminal gets a shell on this server, so this needs your password.
          </FormHelpText>
          <div className="mt-2 flex gap-2">
            <Button type="submit" variant="primary" size="small" disabled={isSaving || password === ""}>
              {isSaving ? "Turning on…" : "Turn on"}
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={isSaving}
              onClick={() => {
                setIsAskingPassword(false);
                setPassword("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </SettingsPanel>
  );
}
