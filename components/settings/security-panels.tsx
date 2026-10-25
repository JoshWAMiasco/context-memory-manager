"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { CheckCircle, Laptop, Lock } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { Badge } from "@/components/primitives/badge";
import { Button } from "@/components/primitives/button";
import { FormCheckbox } from "@/components/primitives/form-check";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { SettingsPanel, SettingsPanelFooter } from "@/components/page-sections/settings/settings-panel";
import { ChangePasswordForm } from "@/components/security/change-password-form";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import type { SessionSummary } from "@/lib/api-types";
import { STEP_UP_ACTION_LABELS, STEP_UP_ACTIONS, type StepUpAction } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";

dayjs.extend(relativeTime);

function announceSaved(title: string, description?: string) {
  showToastNotification({ title, description, icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" /> });
}

/**
 * The change-password card of Security settings (wired to
 * the CMM API). Other sessions of the user are signed out after a change.
 *
 * @example
 * <ChangePasswordPanel username="alice" />
 */
export function ChangePasswordPanel({ username }: { username: string }) {
  const [formKey, setFormKey] = useState(0);
  return (
    <SettingsPanel title="Change password">
      <div className="max-w-lg">
        <ChangePasswordForm
          key={formKey}
          username={username}
          onChanged={() => {
            announceSaved("Password changed", "Your other sessions were signed out.");
            setFormKey((previousKey) => previousKey + 1);
          }}
        />
      </div>
    </SettingsPanel>
  );
}

/**
 * Admin, server mode: which actions need a password confirmation (step-up).
 *
 * @example
 * <StepUpActionsPanel initialActions={["upload", "download"]} />
 */
export function StepUpActionsPanel({ initialActions }: { initialActions: readonly StepUpAction[] }) {
  const [selectedActions, setSelectedActions] = useState<StepUpAction[]>([...initialActions]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  const toggleAction = (action: StepUpAction, isChecked: boolean) =>
    setSelectedActions((previousActions) =>
      isChecked ? [...previousActions, action] : previousActions.filter((previousAction) => previousAction !== action),
    );

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson("/api/settings/security.stepUpActions", { method: "PUT", body: { value: selectedActions } });
      announceSaved("Confirmation rules saved");
    } catch (requestError) {
      setErrorMessage(requestError instanceof ApiError ? requestError.message : "Saving failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsPanel title="Password confirmation (step-up)">
      <form onSubmit={handleSubmit}>
        <p className="mb-5 leading-relaxed text-foreground-muted">
          On this machine and the local network, people confirm their password once per session. From remote networks
          they confirm every time. Choose the actions this applies to.
        </p>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        <div className="flex flex-col gap-3">
          {STEP_UP_ACTIONS.map((action) => (
            <FormCheckbox
              key={action}
              id={`step-up-${action}`}
              label={STEP_UP_ACTION_LABELS[action]}
              checked={selectedActions.includes(action)}
              onChange={(changeEvent) => toggleAction(action, changeEvent.target.checked)}
            />
          ))}
        </div>
        <SettingsPanelFooter>
          <Button type="submit" variant="outline-primary" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Changes"}
          </Button>
        </SettingsPanelFooter>
      </form>
    </SettingsPanel>
  );
}

const NETWORK_LABELS: Record<SessionSummary["networkClass"], string> = {
  desktop: "Desktop app",
  loopback: "This machine",
  lan: "Local network",
  remote: "Remote",
};

function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "Unknown browser";
  if (userAgent.includes("Electron")) return "CMM desktop";
  const browserName = ["Edg", "Firefox", "Chrome", "Safari"].find((candidateName) => userAgent.includes(candidateName));
  const platformName = ["Windows", "Mac OS", "Linux", "Android", "iPhone", "iPad"].find((candidateName) =>
    userAgent.includes(candidateName),
  );
  return [browserName === "Edg" ? "Edge" : browserName, platformName].filter(Boolean).join(" on ") || "Browser";
}

/**
 * The signed-in user's sessions with where they come from, and Revoke for every session but this one.
 *
 * @example
 * <ActiveSessionsPanel />
 */
export function ActiveSessionsPanel() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();

  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    requestJson<{ sessions: SessionSummary[] }>("/api/auth/sessions")
      .then(({ sessions: loadedSessions }) => {
        if (isCurrent) setSessions(loadedSessions);
      })
      .catch((requestError: unknown) => {
        if (isCurrent)
          setErrorMessage(requestError instanceof ApiError ? requestError.message : "Sessions could not be loaded.");
      });
    return () => {
      isCurrent = false;
    };
  }, [reloadCount]);

  async function revokeSession(sessionId: string) {
    try {
      await requestJson(`/api/auth/sessions?id=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      announceSaved("Session revoked");
      setReloadCount((previousCount) => previousCount + 1);
    } catch (requestError) {
      setErrorMessage(requestError instanceof ApiError ? requestError.message : "Revoking failed.");
    }
  }

  return (
    <SettingsPanel title="Active sessions">
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <div className="overflow-x-auto">
        <Table appearance="list" data-testid="sessions-table">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Device</TableHeaderCell>
              <TableHeaderCell>Network</TableHeaderCell>
              <TableHeaderCell>Last active</TableHeaderCell>
              <TableHeaderCell className="text-right">Action</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Laptop className="h-4 w-4 stroke-[1.3] text-foreground-muted" />
                    <span>{describeBrowser(session.userAgent)}</span>
                    {session.current && <Badge tone="success">This session</Badge>}
                    {session.locked && <Lock className="h-3.5 w-3.5 text-warning" aria-label="Locked" />}
                  </div>
                  <div className="mt-1 text-xs text-foreground-muted">{session.ip ?? "unknown address"}</div>
                </TableCell>
                <TableCell>{NETWORK_LABELS[session.networkClass]}</TableCell>
                <TableCell title={dayjs(session.lastActivityAt).format("YYYY-MM-DD HH:mm")}>
                  {dayjs(session.lastActivityAt).fromNow()}
                </TableCell>
                <TableCell className="text-right">
                  {!session.current && (
                    <Button size="small" variant="outline-danger" onClick={() => void revokeSession(session.id)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SettingsPanel>
  );
}
