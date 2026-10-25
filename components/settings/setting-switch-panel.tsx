"use client";

import { CheckCircle } from "lucide-react";
import { useState } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { FormSwitch } from "@/components/primitives/form-check";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { ApiError, requestJson } from "@/lib/client/api";

/**
 * A settings card with one on/off setting, saved as soon as it is switched.
 *
 * @example
 * <SettingSwitchPanel title="Strong lock" settingKey="protection.macosImmutable" label="…" description="…" initialValue={false} />
 */
export function SettingSwitchPanel({
  title,
  settingKey,
  label,
  description,
  initialValue,
}: {
  title: string;
  settingKey: string;
  label: string;
  description: string;
  initialValue: boolean;
}) {
  const [isOn, setIsOn] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const toggle = async (nextValue: boolean) => {
    setIsOn(nextValue);
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson(`/api/settings/${encodeURIComponent(settingKey)}`, {
        method: "PUT",
        body: { value: nextValue },
      });
      showToastNotification({
        title: `${title} saved`,
        icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" />,
      });
    } catch (saveError) {
      setIsOn(!nextValue);
      setErrorMessage(saveError instanceof ApiError ? saveError.message : "Saving failed.");
    } finally {
      setIsSaving(false);
    }
  };
  const inputIdentifier = `setting-${settingKey.replaceAll(".", "-")}`;
  return (
    <SettingsPanel title={title}>
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <FormSwitch
        id={inputIdentifier}
        label={label}
        description={description}
        checked={isOn}
        disabled={isSaving}
        onChange={(changeEvent) => void toggle(changeEvent.target.checked)}
      />
    </SettingsPanel>
  );
}
