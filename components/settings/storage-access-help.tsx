"use client";

import { AlertCircle, Copy, Info } from "lucide-react";
import { announce } from "@/components/explorer/explorer-context";
import { Button } from "@/components/primitives/button";
import { StaticAlert } from "@/components/primitives/static-alert";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** A shell command in a monospace box with a Copy button. */
function CommandLine({ command }: { command: string }) {
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      announce("Command copied", command);
    } catch {
      announce("Copying isn't allowed here", "Select the command and copy it by hand.");
    }
  };
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <code
        className="flex-1 font-mono text-xs break-all text-foreground-strong select-all"
        data-testid="add-storage-command"
      >
        {command}
      </code>
      <Button
        size="small"
        variant="outline-secondary"
        className="flex-none"
        aria-label="Copy command"
        title="Copy command"
        onClick={() => void copyCommand()}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AddStorageSteps() {
  return (
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-foreground-muted">
      <li>Open a terminal on the server (directly or over SSH).</li>
      <li>Run the command below and enter your password when sudo asks.</li>
      <li>Reload this page. The folder appears under Internal storages, ready to read and write.</li>
    </ol>
  );
}

/**
 * Server mode: how to add a folder CMM can't reach on its own. The service runs as the `cmm`
 * user, so home folders (0750 on Ubuntu) need `sudo cmm add-storage`. The command follows what
 * is typed in the add form.
 *
 * @example
 * <StorageSetupBanner command="sudo cmm add-storage /home/alex/notes --label Notes" />
 */
export function StorageSetupBanner({ command, className }: { command: string; className?: string }) {
  return (
    <StaticAlert
      tone="primary"
      variant="soft"
      role="note"
      data-testid="storage-setup-banner"
      className={mergeClassNames("flex items-start", className)}
    >
      <div className="flex gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5]" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Adding a folder from your home folder?</div>
          <p className="mt-1 text-foreground-muted">
            CMM runs as its own <code className="font-mono">cmm</code> user, which can&apos;t open private folders such
            as <code className="font-mono">/home/you</code>. Folders under <code className="font-mono">/srv/cmm</code>{" "}
            work from this page; for any other folder, give CMM access once from the server:
          </p>
          <AddStorageSteps />
          <CommandLine command={command} />
        </div>
      </div>
    </StaticAlert>
  );
}

/**
 * The add form's error. With `command` (CMM was denied access to the folder) it explains why and
 * shows the command that grants access; otherwise it is a one-line error.
 *
 * @example
 * <StorageAddErrorBanner message="CMM doesn't have permission to open that folder." command="sudo cmm add-storage …" />
 */
export function StorageAddErrorBanner({
  message,
  command,
  className,
}: {
  message?: string;
  command?: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <StaticAlert
      tone="danger"
      variant="soft"
      role="alert"
      data-testid="form-error"
      className={mergeClassNames("flex items-start", className)}
    >
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5]" />
        <div className="min-w-0 flex-1">
          <div className={command ? "font-medium" : undefined}>{message}</div>
          {command && (
            <>
              <p className="mt-1 text-foreground-muted">
                The folder or one of its parents (often your home folder) is private, and CMM can&apos;t change
                permissions from the browser. Grant access from the server:
              </p>
              <AddStorageSteps />
              <CommandLine command={command} />
            </>
          )}
        </div>
      </div>
    </StaticAlert>
  );
}
