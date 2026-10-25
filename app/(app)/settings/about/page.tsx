import type { Metadata } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BookOpen } from "lucide-react";
import { ButtonLink } from "@/components/primitives/button";
import { FormSectionRow } from "@/components/primitives/form-section-row";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { ThirdPartyLicenses } from "@/components/settings/third-party-licenses";
import { THEME_IDENTITY } from "@/configuration/theme-identity";
import { PDF_GUIDES, type PdfGuideName } from "@/lib/pdf-guides";
import packageManifest from "@/package.json";
import { getConfig } from "@/server/config";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "About" };

const ATTRIBUTIONS = [
  { name: "Oxanium", detail: "display font", license: "SIL Open Font License 1.1" },
  { name: "Martian Mono", detail: "body font", license: "SIL Open Font License 1.1" },
  { name: "Lucide", detail: "interface icons", license: "ISC License" },
  {
    name: "vscode-icons",
    detail: "file and folder icons, by Roberto Huertas and contributors",
    license: "CC BY-SA 4.0",
  },
  { name: "vscode-icons-js", detail: "file name to icon mapping, by Dominik Eckelmann", license: "MIT License" },
  { name: "Iconoir", detail: "memory (brain) icon, by Luca Burgio", license: "MIT License" },
  { name: "MingCute Icon", detail: "USB flash drive icon, by MingCute Design", license: "Apache License 2.0" },
  { name: "Next.js, React", detail: "application framework", license: "MIT License" },
];

/** The `VERSION` file the icon copy script writes, for the attribution. */
function readIconVersion(): string {
  try {
    return readFileSync(path.join(process.cwd(), "public", "icons", "vscode", "VERSION"), "utf8").split("\n")[0] ?? "";
  } catch {
    return "";
  }
}

/** Whether a bundled PDF guide is in this build (the entry sets `CMM_DOCS_DIR`). */
function hasGuide(guideName: PdfGuideName): boolean {
  const guidesDirectory = process.env.CMM_DOCS_DIR;
  if (!guidesDirectory) return false;
  // The ignore comment keeps Turbopack's file tracer from matching this runtime path across the project.
  // eslint-disable-next-line no-inline-comments
  return existsSync(path.join(/* turbopackIgnore: true */ guidesDirectory, PDF_GUIDES[guideName].fileName));
}

export default async function AboutSettingsPage() {
  await requirePageSession();
  const iconVersion = readIconVersion();
  const isServer = getConfig().mode === "server";
  // The guide for this mode first; the other one is useful too (a server admin's own desktop, and the reverse).
  const guideNames: PdfGuideName[] = isServer ? ["server-guide", "desktop-guide"] : ["desktop-guide", "server-guide"];
  return (
    <>
      <SettingsPanel title={`About ${THEME_IDENTITY.themeDisplayName}`}>
        <FormSectionRow label="Product" labelWidth="large">
          {THEME_IDENTITY.productName}
        </FormSectionRow>
        <FormSectionRow label="Version" labelWidth="large">
          <span data-testid="about-version">{packageManifest.version}</span>
        </FormSectionRow>
        <FormSectionRow label="Mode" labelWidth="large">
          {isServer ? "Server" : "Desktop"}
        </FormSectionRow>
        <FormSectionRow
          label="Network"
          description="CMM never contacts the internet: no telemetry, no update checks, no remote fonts."
          labelWidth="large"
        >
          Fully offline
        </FormSectionRow>
      </SettingsPanel>
      <SettingsPanel title="Guides">
        <p className="mb-4 text-sm text-foreground-muted">
          Illustrated PDF guides: installing CMM, every feature step by step, and what to do when something goes wrong.
          They open in a new tab and work offline.
        </p>
        <ul className="flex flex-col gap-3" data-testid="about-guides">
          {guideNames.map((guideName, guideIndex) => (
            <li key={guideName} className="flex flex-wrap items-center gap-3">
              {hasGuide(guideName) ? (
                <ButtonLink
                  href={`/api/docs/${guideName}`}
                  prefetch={false}
                  target="_blank"
                  rel="noopener"
                  variant={guideIndex === 0 ? "primary" : "outline-secondary"}
                  leadingIcon={<BookOpen className="mr-2 h-4 w-4" aria-hidden />}
                  data-testid={`open-${guideName}`}
                >
                  Open {PDF_GUIDES[guideName].title}
                </ButtonLink>
              ) : (
                <span className="text-sm text-foreground-subtle" data-testid={`missing-${guideName}`}>
                  The {PDF_GUIDES[guideName].title} is not included in this build.
                </span>
              )}
              <span className="text-xs text-foreground-subtle">{PDF_GUIDES[guideName].fileName}</span>
            </li>
          ))}
        </ul>
      </SettingsPanel>
      <SettingsPanel title="Licenses and attributions">
        <ul className="flex flex-col gap-3">
          {ATTRIBUTIONS.map((attribution) => (
            <li key={attribution.name} className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
              <span className="font-medium">{attribution.name}</span>
              <span className="text-foreground-muted">{attribution.detail}</span>
              <span className="text-xs text-foreground-subtle sm:ml-auto">{attribution.license}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-foreground-muted" data-testid="icon-attribution">
          File icons come from vscode-icons ({iconVersion.replace(/^icons: /, "") || "bundled copy"}), licensed under
          the Creative Commons Attribution-ShareAlike 4.0 International license and shipped unchanged in
          public/icons/vscode with their LICENSE file.
        </p>
      </SettingsPanel>
      <SettingsPanel title="Third-party software">
        <ThirdPartyLicenses />
      </SettingsPanel>
    </>
  );
}
