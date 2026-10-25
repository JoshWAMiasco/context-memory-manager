"use client";

import { TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";

/**
 * Shown inside the app's frame when a page fails to render (for example, a drive vanished while
 * the page loaded). The top bar keeps working; Try again renders the page once more.
 */
export default function SignedInError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      className="min-h-[60vh]"
      icon={<TriangleAlert className="h-12 w-12 stroke-[1] text-warning" aria-hidden />}
      title="This page couldn't be shown"
      description={
        <>
          Something went wrong while loading it. Your files are not affected.
          {error.digest ? (
            <span className="mt-2 block text-xs text-foreground-subtle">
              Reference for the server log: <span className="font-mono">{error.digest}</span>
            </span>
          ) : null}
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => reset()}>
            Try again
          </Button>
          <ButtonLink href="/" variant="outline-secondary">
            Go to your files
          </ButtonLink>
        </div>
      }
    />
  );
}
