"use client";

import dayjs from "dayjs";
import { useState } from "react";
import { Button } from "@/components/primitives/button";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormTextarea } from "@/components/primitives/form-textarea";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { MemoryAppearanceFields } from "@/components/memory/memory-appearance-fields";
import { useStat } from "@/lib/client/fs";
import { useMemory, useMemoryMutations } from "@/lib/client/memory";
import type { MemoryColor, MemoryIcon, MemorySummary } from "@/lib/memory";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

function MemoryForm({
  memory,
  folderPath,
  writeReason,
}: {
  memory: MemorySummary;
  folderPath: string;
  writeReason?: string;
}) {
  const { storage } = useExplorer();
  const { updateMemory, convertMemory } = useMemoryMutations();
  const [name, setName] = useState(memory.name);
  const [description, setDescription] = useState(memory.description);
  const [icon, setIcon] = useState<MemoryIcon>(memory.icon ?? "brain");
  const [color, setColor] = useState<MemoryColor>(memory.color ?? "violet");
  const isChanged =
    name.trim() !== memory.name ||
    description !== memory.description ||
    icon !== (memory.icon ?? "brain") ||
    color !== (memory.color ?? "violet");

  const save = async () => {
    try {
      await updateMemory.mutateAsync({
        storageId: storage.id,
        path: folderPath,
        name: name.trim(),
        description,
        icon,
        color,
      });
      announce("Memory saved");
    } catch (saveError) {
      announceError("Couldn't save the memory", saveError);
    }
  };

  const convertToFolder = async () => {
    try {
      await convertMemory.mutateAsync({ storageId: storage.id, path: folderPath, to: "folder" });
      announce("Memory is now a plain folder", "Its files stay as they are.");
    } catch (convertError) {
      announceError("Couldn't convert the memory", convertError);
    }
  };

  const isDisabled = writeReason !== undefined;
  return (
    <div className="grid gap-4" data-testid="memory-settings-form">
      <div>
        <FormLabel htmlFor="settings-memory-name">Name</FormLabel>
        <FormInput
          id="settings-memory-name"
          value={name}
          disabled={isDisabled}
          onChange={(changeEvent) => setName(changeEvent.target.value)}
        />
      </div>
      <div>
        <FormLabel htmlFor="settings-memory-description">Description</FormLabel>
        <FormTextarea
          id="settings-memory-description"
          rows={3}
          value={description}
          disabled={isDisabled}
          onChange={(changeEvent) => setDescription(changeEvent.target.value)}
        />
      </div>
      <MemoryAppearanceFields
        icon={icon}
        color={color}
        onIconChange={setIcon}
        onColorChange={setColor}
        isDisabled={isDisabled}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline-secondary"
          disabled={isDisabled || convertMemory.isPending}
          onClick={() => void convertToFolder()}
          data-testid="convert-to-folder"
        >
          Convert to plain folder
        </Button>
        <div className="flex items-center gap-3">
          {writeReason && <span className="text-sm text-foreground-subtle">{writeReason}</span>}
          <Button
            variant="primary"
            disabled={isDisabled || !isChanged || updateMemory.isPending}
            onClick={() => void save()}
            data-testid="memory-settings-save"
          >
            {updateMemory.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The General tab of Folder settings: a memory's name, description, icon and colour (or
 * Convert to memory for a plain folder), plus where the folder is and when it was created.
 *
 * @example
 * <GeneralTab path="persona" />
 */
export function GeneralTab({ path: folderPath }: { path: string }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const { data: memory, isPending } = useMemory(storage.id, folderPath);
  const { data: folderStat } = useStat(storage.id, folderPath);
  const writeReason = explorer.readWriteReason(folderPath);
  return (
    <div className="grid gap-6" data-testid="general-tab">
      {isPending ? (
        <LoadingSkeleton rows={3} label="Loading…" />
      ) : memory ? (
        <MemoryForm key={memory.id} memory={memory} folderPath={folderPath} writeReason={writeReason} />
      ) : (
        <div className="rounded-md border border-line bg-surface-subtle p-4">
          <div className="font-medium">Plain folder</div>
          <p className="mt-1 text-sm text-foreground-muted">
            Make it a memory to give it a name, icon and colour, and an overview of what it holds. The files stay where
            they are.
          </p>
          <Button
            variant="outline-primary"
            className="mt-3"
            disabled={writeReason !== undefined}
            onClick={() => explorer.openDialog({ kind: "convert-memory", path: folderPath })}
            data-testid="convert-to-memory"
          >
            Convert to memory
          </Button>
        </div>
      )}
      <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <dt className="text-foreground-subtle">Location</dt>
        <dd className="break-all">
          {storage.label} / {folderPath}
        </dd>
        <dt className="text-foreground-subtle">Created</dt>
        <dd>{folderStat ? dayjs(folderStat.entry.createdMs).format("MMM D, YYYY HH:mm") : "…"}</dd>
        {memory && (
          <>
            <dt className="text-foreground-subtle">Memory since</dt>
            <dd>{dayjs(memory.createdAt).format("MMM D, YYYY HH:mm")}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
