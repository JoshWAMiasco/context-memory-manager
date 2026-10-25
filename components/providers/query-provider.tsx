"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/client/api";

/** Client errors (4xx) are answers, not glitches: retrying them only repeats the message. */
function shouldRetry(failureCount: number, queryError: unknown): boolean {
  if (queryError instanceof ApiError && queryError.status >= 400 && queryError.status < 500) return false;
  return failureCount < 2;
}

/**
 * The TanStack Query client for signed-in pages: data stays fresh for 30 seconds and is not
 * refetched on window focus, because server events invalidate what changed.
 *
 * @example
 * <QueryProvider>{children}</QueryProvider>
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
