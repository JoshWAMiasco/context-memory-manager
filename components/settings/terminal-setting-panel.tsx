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

/** Claude Code's native installer, run as the service user; it installs to /var/lib/cmm/.local/bin. */
const CLAUDE_INSTALL_COMMAND = "sudo -u cmm -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'";

/**
 * Settings › Security › Terminals: whether admins may open terminals in folders. On a server,
 * turning them on asks for the admin's password first, since a terminal is a shell on that machine,
 * and the panel shows how to install Claude Code for the `cmm` user the terminals run as.
 *
 * @example
 * <TerminalSettingPanel initialValue={false} needsPasswordToEnable showsClaudeSetup />
 */
export function TerminalSettingPanel({
  initialValue,
  needsPasswordToEnable,
  showsClaudeSetup = false,
}: {
  initialValue: boolean;
  needsPasswordToEnable: boolean;
  showsClaudeSetup?: boolean;
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
      {showsClaudeSetup && (
        <section className="mt-5 grid gap-1.5" data-testid="terminal-claude-setup">
          <h3 className="text-sm font-medium text-foreground-strong">Claude Code in terminals</h3>
          <FormHelpText>
            Terminals run as the <code className="text-brand">cmm</code> user, so Claude Code must be installed for
            that user. Run this on the server (it needs internet access):
          </FormHelpText>
          <pre className="overflow-x-auto rounded border border-line px-3 py-2 font-mono text-xs leading-relaxed text-foreground-muted select-all">
            {CLAUDE_INSTALL_COMMAND}
          </pre>
          <FormHelpText>
            Then open a new terminal and run <code className="text-brand">claude</code>; the first time it asks you to
            sign in. Claude Code can read and change everything the terminal can, including CMM&apos;s own data.
          </FormHelpText>
        </section>
      )}
    </SettingsPanel>
  );
}
