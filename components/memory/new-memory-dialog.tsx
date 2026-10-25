"use client";

import { FileText, Folder } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormErrorMessage, FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormTextarea } from "@/components/primitives/form-textarea";
import { announce, announceError } from "@/components/explorer/explorer-context";
import { MemoryAppearanceFields } from "@/components/memory/memory-appearance-fields";
import { useMemoryMutations, useMemoryTemplates } from "@/lib/client/memory";
import { findNameProblem } from "@/lib/fs/validate-name";
import { slugifyMemoryName, type MemoryColor, type MemoryIcon } from "@/lib/memory";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type NewMemoryTarget =
  { kind: "create"; parentPath: string } | { kind: "convert"; path: string; folderName: string };

/**
 * Creates a memory (name, description, icon, colour, template, folder name) or turns an existing
 * folder into one. Opened from the toolbar, the context menu and the folder overview.
 *
 * @example
 * <NewMemoryDialog storageId={storage.id} target={{ kind: "create", parentPath: "" }} onDone={select} onClose={close} />
 */
export function NewMemoryDialog({
  storageId,
  target,
  onDone,
  onClose,
}: {
  storageId: string;
  target: NewMemoryTarget;
  onDone: (memoryPath: string) => void;
  onClose: () => void;
}) {
  const isCreating = target.kind === "create";
  const { data: templates = [] } = useMemoryTemplates();
  const { createMemory, convertMemory } = useMemoryMutations();
  const [name, setName] = useState(isCreating ? "" : target.folderName);
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<MemoryIcon>("brain");
  const [color, setColor] = useState<MemoryColor>("violet");
  const [templateId, setTemplateId] = useState("blank");
  const [folderName, setFolderName] = useState<string>();
  const [isTouched, setIsTouched] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const effectiveFolderName = folderName ?? slugifyMemoryName(name);
  const nameProblem = name.trim() === "" ? "Enter a name." : undefined;
  const folderProblem = isCreating ? findNameProblem(effectiveFolderName) : undefined;
  const selectedTemplate = templates.find((template) => template.id === templateId);

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setIsTouched(true);
    if (nameProblem || folderProblem) return;
    setIsBusy(true);
    try {
      const fields = { name: name.trim(), description: description.trim() || undefined, icon, color };
      if (target.kind === "create") {
        const { entry } = await createMemory.mutateAsync({
          storageId,
          parentPath: target.parentPath,
          folderName: effectiveFolderName,
          template: templateId,
          ...fields,
        });
        announce("Memory created", fields.name);
        onDone(entry.path);
      } else {
        await convertMemory.mutateAsync({ storageId, path: target.path, to: "memory", ...fields });
        announce("Folder is now a memory", fields.name);
        onDone(target.path);
      }
      onClose();
    } catch (submitError) {
      announceError(isCreating ? "Couldn't create the memory" : "Couldn't convert the folder", submitError);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={isCreating ? "New memory" : "Convert to memory"}
      size="extra-large"
    >
      <form onSubmit={(submitEvent) => void submit(submitEvent)} noValidate data-testid="new-memory-dialog">
        <ModalBody className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FormLabel htmlFor="memory-name">Name</FormLabel>
              <FormInput
                id="memory-name"
                value={name}
                autoFocus
                placeholder="Claude persona"
                onChange={(changeEvent) => setName(changeEvent.target.value)}
                hasError={isTouched && nameProblem !== undefined}
              />
              <FormErrorMessage message={isTouched ? nameProblem : undefined} />
            </div>
            {isCreating && (
              <div>
                <FormLabel htmlFor="memory-folder-name">Folder name</FormLabel>
                <FormInput
                  id="memory-folder-name"
                  value={effectiveFolderName}
                  spellCheck={false}
                  onChange={(changeEvent) => setFolderName(changeEvent.target.value)}
                  hasError={isTouched && folderProblem !== undefined}
                />
                <FormErrorMessage message={isTouched ? folderProblem : undefined} />
                {!folderProblem && <FormHelpText>Made from the name unless you change it.</FormHelpText>}
              </div>
            )}
          </div>
          <div>
            <FormLabel htmlFor="memory-description">Description</FormLabel>
            <FormTextarea
              id="memory-description"
              rows={2}
              value={description}
              placeholder="What this memory holds and which tools use it"
              onChange={(changeEvent) => setDescription(changeEvent.target.value)}
            />
          </div>
          <MemoryAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
          {isCreating && (
            <div>
              <FormLabel id="memory-template-label">Template</FormLabel>
              <div className="mt-1 grid gap-3 md:grid-cols-[1fr_14rem]">
                <div role="radiogroup" aria-labelledby="memory-template-label" className="grid gap-2 sm:grid-cols-2">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      role="radio"
                      aria-checked={templateId === template.id}
                      data-testid={`memory-template-${template.id}`}
                      onClick={() => setTemplateId(template.id)}
                      className={mergeClassNames(
                        "cursor-pointer rounded-md border border-line p-3 text-left hover:border-line-strong",
                        templateId === template.id && "border-brand bg-surface-strong",
                      )}
                    >
                      <div className="font-medium">{template.name}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{template.description}</div>
                    </button>
                  ))}
                </div>
                <div
                  className="rounded-md border border-line bg-surface-subtle p-3 text-xs"
                  data-testid="memory-template-preview"
                >
                  <div className="mb-2 font-medium text-foreground-muted">{effectiveFolderName || "memory"}/</div>
                  {selectedTemplate && selectedTemplate.paths.length === 0 && (
                    <div className="text-foreground-subtle">No files: start empty.</div>
                  )}
                  <ul className="grid gap-1">
                    {selectedTemplate?.paths.map((templatePath) => (
                      <li key={templatePath} className="flex items-center gap-1.5 pl-3">
                        {templatePath.endsWith("/") ? (
                          <Folder className="h-3.5 w-3.5 text-warning" aria-hidden />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-info" aria-hidden />
                        )}
                        {templatePath}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button type="submit" variant="primary" disabled={isBusy} data-testid="new-memory-submit">
            {isBusy ? "Working…" : isCreating ? "Create memory" : "Convert"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
