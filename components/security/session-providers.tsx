"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import { IdleLockProvider } from "@/components/security/idle-lock-provider";
import { StepUpModalProvider } from "@/components/security/step-up-modal";
import { useServerEventInvalidation } from "@/hooks/use-server-events";

function ServerEventsBridge() {
  useServerEventInvalidation();
  return null;
}

/**
 * The client-side machinery for signed-in pages: idle auto-lock, the step-up modal, the query
 * cache and the server-event stream that keeps it fresh.
 *
 * @example
 * <SessionProviders autoLockSeconds={900}>{children}</SessionProviders>
 */
export function SessionProviders({ autoLockSeconds, children }: { autoLockSeconds: number; children: ReactNode }) {
  return (
    <IdleLockProvider autoLockSeconds={autoLockSeconds}>
      <StepUpModalProvider>
        <QueryProvider>
          <ServerEventsBridge />
          {children}
        </QueryProvider>
      </StepUpModalProvider>
    </IdleLockProvider>
  );
}
