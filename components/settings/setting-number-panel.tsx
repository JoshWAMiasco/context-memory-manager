"use client";

import { CheckCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { Button } from "@/components/primitives/button";
import { FormInput } from "@/components/primitives/form-input";
import { FormSectionRow } from "@/components/primitives/form-section-row";
import { SettingsPanel, SettingsPanelFooter } from "@/components/page-sections/settings/settings-panel";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { ApiError, requestJson } from "@/lib/client/api";

export interface SettingNumberField {
  settingKey: string;
  label: string;
  description: string;
  initialValue: number;
  minimum: number;
  maximum: number;
  unit: string;
  /** The stored value is the shown value times this (for example 1048576 to show bytes as MB). */
  scale?: number;
}

export interface SettingNumberPanelProps {
  title: string;
  intro?: ReactNode;
  fields: readonly SettingNumberField[];
}

function toInputIdentifier(settingKey: string): string {
  return `setting-${settingKey.replaceAll(".", "-")}`;
}

/**
 * A settings card with one or more whole-number settings, saved together through
 * `PUT /api/settings/[key]`. Every value is checked against its range before anything is saved.
 *
 * @example
 * <SettingNumberPanel
 *   title="Auto-lock"
 *   fields={[{ settingKey: "security.autoLockMinutes", label: "Lock after", description: "…", initialValue: 15, minimum: 1, maximum: 1440, unit: "idle minutes" }]}
 * />
 */
export function SettingNumberPanel({ title, intro, fields }: SettingNumberPanelProps) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.settingKey, String(field.initialValue / (field.scale ?? 1))])),
  );
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const parsedValues: [SettingNumberField, number][] = [];
    for (const field of fields) {
      const parsedValue = Number(fieldValues[field.settingKey]);
      if (!Number.isInteger(parsedValue) || parsedValue < field.minimum || parsedValue > field.maximum) {
        setErrorMessage(`${field.label}: enter a whole number from ${field.minimum} to ${field.maximum}.`);
        return;
      }
      parsedValues.push([field, parsedValue]);
    }
    setErrorMessage(undefined);
    setIsSaving(true);
    try {
      for (const [field, parsedValue] of parsedValues) {
        await requestJson(`/api/settings/${encodeURIComponent(field.settingKey)}`, {
          method: "PUT",
          body: { value: parsedValue * (field.scale ?? 1) },
        });
      }
      showToastNotification({
        title: `${title} saved`,
        icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" />,
      });
    } catch (requestError) {
      setErrorMessage(requestError instanceof ApiError ? requestError.message : "Saving failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsPanel title={title}>
      <form onSubmit={handleSubmit} noValidate>
        {intro && <div className="mb-5 leading-relaxed text-foreground-muted">{intro}</div>}
        <FormErrorAlert message={errorMessage} className="mb-4" />
        {fields.map((field) => (
          <FormSectionRow
            key={field.settingKey}
            label={field.label}
            htmlFor={toInputIdentifier(field.settingKey)}
            description={field.description}
            labelWidth="large"
          >
            <div className="flex items-center gap-3">
              <FormInput
                id={toInputIdentifier(field.settingKey)}
                type="number"
                min={field.minimum}
                max={field.maximum}
                value={fieldValues[field.settingKey] ?? ""}
                onChange={(changeEvent) =>
                  setFieldValues((previousValues) => ({
                    ...previousValues,
                    [field.settingKey]: changeEvent.target.value,
                  }))
                }
                className="max-w-36"
              />
              <span className="text-foreground-muted">{field.unit}</span>
            </div>
          </FormSectionRow>
        ))}
        <SettingsPanelFooter>
          <Button type="submit" variant="outline-primary" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Changes"}
          </Button>
        </SettingsPanelFooter>
      </form>
    </SettingsPanel>
  );
}
