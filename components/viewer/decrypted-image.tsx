"use client";

import { useEffect, useState } from "react";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import { ImageViewer } from "@/components/viewer/image-viewer";
import type { FileEntry } from "@/lib/api-types";
import { fetchWithProgress, type TransferProgress } from "@/lib/client/fetch-with-progress";

/**
 * An image from an encrypted folder: its decrypted bytes are fetched with progress
 * ("Decrypting… N%") into a `blob:` URL that only this tab can see, revoked when the viewer
 * closes, so the decrypted image is never cached.
 *
 * Key it by `source`, so a new version starts from a clean state.
 *
 * @example
 * <DecryptedImage key={rawUrl} entry={entry} source={rawUrl} onFail={showPlaceholder} />
 */
export function DecryptedImage({ entry, source, onFail }: { entry: FileEntry; source: string; onFail: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string>();
  const [progress, setProgress] = useState<TransferProgress>();
  const [loadError, setLoadError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let createdUrl: string | undefined;
    fetchWithProgress(source, { signal: controller.signal, onProgress: setProgress, expectedBytes: entry.size }).then(
      ({ bytes }) => {
        createdUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
        setObjectUrl(createdUrl);
      },
      (fetchError: unknown) => {
        if (!controller.signal.aborted) setLoadError(fetchError);
      },
    );
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attempt, entry.size, source]);

  const retry = () => {
    setLoadError(undefined);
    setObjectUrl(undefined);
    setAttempt((count) => count + 1);
  };
  if (loadError) return <ContentError error={loadError} onRetry={retry} />;
  if (!objectUrl) return <ContentLoader entry={entry} progress={progress} variant="image" label="Decrypting…" />;
  return <ImageViewer source={objectUrl} name={entry.name} onFail={onFail} />;
}
