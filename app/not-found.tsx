import { FileQuestion } from "lucide-react";
import { ButtonLink } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";

/** Any address CMM doesn't have, or a page this account may not open (admins-only settings). */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6" data-testid="not-found-page">
      <EmptyState
        icon={<FileQuestion className="h-12 w-12 stroke-[1]" aria-hidden />}
        title="This page doesn't exist"
        description="The link may be old, or the page is only for admins."
        action={
          <ButtonLink href="/" variant="primary">
            Go to your files
          </ButtonLink>
        }
      />
    </main>
  );
}
