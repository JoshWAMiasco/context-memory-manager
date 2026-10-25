"use client";

import { CheckCircle2, FileKey2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/primitives/button";
import { LEGACY_KEY_FILE_EXTENSION } from "@/lib/fs/legacy-names";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** Key files CMM writes; the CCM-era extension is accepted too. */
const KEY_FILE_EXTENSION = ".cmmkey";

/**
 * Drop or choose a `.cmmkey` key file. The file is read by the server only; the
 * browser just passes it on.
 *
 * @example
 * <KeyFileDropzone file={keyFile} onFile={setKeyFile} />
 */
export function KeyFileDropzone({
  file,
  onFile,
  label = "Key file",
  testId = "keyfile-dropzone",
  isDisabled = false,
}: {
  file?: File;
  onFile: (file: File | undefined) => void;
  label?: string;
  testId?: string;
  isDisabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  return (
    <div>
      <label htmlFor={inputId} className="mb-2 inline-block">
        {label}
      </label>
      <div
        data-testid={testId}
        className={mergeClassNames(
          "flex items-center gap-3 rounded-md border border-dashed border-line-strong p-4 transition-colors",
          isDragging && "border-brand bg-brand/5",
          file && "border-solid border-success/50 bg-success/5",
        )}
        onDragOver={(dragEvent) => {
          if (isDisabled || !dragEvent.dataTransfer.types.includes("Files")) return;
          dragEvent.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(dragEvent) => {
          if (isDisabled) return;
          dragEvent.preventDefault();
          setIsDragging(false);
          const droppedFile = dragEvent.dataTransfer.files[0];
          if (droppedFile) onFile(droppedFile);
        }}
      >
        {file ? (
          <CheckCircle2 className="h-6 w-6 flex-none text-success" aria-hidden />
        ) : (
          <FileKey2 className="h-6 w-6 flex-none text-foreground-subtle" aria-hidden />
        )}
        <div className="min-w-0 flex-1 text-sm">
          {file ? (
            <span className="block truncate font-medium" data-testid={`${testId}-name`}>
              {file.name}
            </span>
          ) : (
            <span className="text-foreground-muted">Drop the .cmmkey file here, or choose it.</span>
          )}
        </div>
        <Button
          variant="outline-secondary"
          size="small"
          disabled={isDisabled}
          onClick={() => inputRef.current?.click()}
        >
          {file ? "Change" : "Choose file"}
        </Button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={`${KEY_FILE_EXTENSION},${LEGACY_KEY_FILE_EXTENSION},application/json`}
          className="sr-only"
          data-testid={`${testId}-input`}
          disabled={isDisabled}
          onChange={(changeEvent) => {
            onFile(changeEvent.target.files?.[0]);
            changeEvent.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
