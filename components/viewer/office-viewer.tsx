"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { PlaceholderViewer } from "@/components/viewer/placeholder-viewer";
import type { FileEntry, OfficeDetection } from "@/lib/api-types";
import { ApiError, requestJson } from "@/lib/client/api";
import { fetchBytes } from "@/lib/client/fs";

/** What to say when LibreOffice is missing: how to get it on the machine CMM runs on. */
function describeMissingLibreOffice(mode: "desktop" | "server"): string {
  return mode === "server"
    ? "Previewing this file needs LibreOffice on the CMM server. An admin can install it (sudo apt install libreoffice-nogui, or the .deb packages copied from another computer), then open the file again."
    : "Previewing this file needs LibreOffice on this computer. Install it from libreoffice.org, then open the file again.";
}

/**
 * pptx, the older doc/xls/ppt, OpenDocument and RTF files: converted to PDF by LibreOffice on the
 * machine CMM runs on (cached by version, so a second look is instant), then shown in the PDF
 * viewer. Without LibreOffice, the placeholder says how to get it. Files in an encrypted folder
 * aren't converted (no decrypted copy is made); the placeholder says so.
 *
 * @example
 * <OfficeViewer entry={entry} storageId={storage.id} etag={fileStat.etag} mode="server" onDownload={download} />
 */
export function OfficeViewer({
  entry,
  storageId,
  etag,
  mode,
  isEncrypted,
  onDownload,
}: {
  entry: FileEntry;
  storageId: string;
  etag: string;
  mode: "desktop" | "server";
  isEncrypted: boolean;
  onDownload: () => void;
}) {
  const office = useQuery({
    queryKey: ["office", "status"],
    queryFn: ({ signal }) => requestJson<OfficeDetection>("/api/office/status", { signal }),
    staleTime: 60_000,
    enabled: !isEncrypted,
  });
  const source = `/api/office/preview?${new URLSearchParams({ storageId, path: entry.path, v: etag })}`;
  const [converted, setConverted] = useState<{ source: string; pdf?: ArrayBuffer; error?: unknown }>();
  const [attempt, setAttempt] = useState(0);
  const [pdfFailure, setPdfFailure] = useState<string>();
  const isInstalled = office.data?.installed === true;

  useEffect(() => {
    if (!isInstalled || isEncrypted) return;
    const controller = new AbortController();
    fetchBytes(source, controller.signal).then(
      (pdf) => setConverted({ source, pdf }),
      (error: unknown) => {
        if (!controller.signal.aborted) setConverted({ source, error });
      },
    );
    return () => controller.abort();
  }, [attempt, isEncrypted, isInstalled, source]);

  if (isEncrypted) {
    return (
      <PlaceholderViewer
        entry={entry}
        message="Files in an encrypted folder aren't converted for preview, so no decrypted copy is made. Download it to open it."
        onDownload={onDownload}
      />
    );
  }
  if (office.data && !isInstalled) {
    return <PlaceholderViewer entry={entry} message={describeMissingLibreOffice(mode)} onDownload={onDownload} />;
  }
  if (pdfFailure) return <PlaceholderViewer entry={entry} message={pdfFailure} onDownload={onDownload} />;
  if (converted?.source === source && converted.error !== undefined) {
    const { error } = converted;
    if (error instanceof ApiError && error.code === "OFFICE_UNAVAILABLE") {
      return <PlaceholderViewer entry={entry} message={describeMissingLibreOffice(mode)} onDownload={onDownload} />;
    }
    return (
      <ContentError
        error={error}
        onDownload={onDownload}
        onRetry={() => {
          setConverted(undefined);
          setAttempt(attempt + 1);
        }}
      />
    );
  }
  if (converted?.source !== source || !converted.pdf) {
    return <ContentLoader entry={entry} variant="text" label="Converting with LibreOffice…" />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="office-viewer">
      <PdfViewer source={converted.pdf} onFail={setPdfFailure} />
    </div>
  );
}
