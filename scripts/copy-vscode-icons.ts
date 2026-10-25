/*
 * Copies the vscode-icons SVGs that CMM's file tree can show into public/icons/vscode/,
 * so the build needs no network. Run it again after upgrading vscode-icons-js:
 *
 *   npx tsx scripts/copy-vscode-icons.ts                     # from the installed VS Code extension
 *   npx tsx scripts/copy-vscode-icons.ts --from <icons dir>  # from an extracted vscode-icons release
 *
 * It copies every icon the vscode-icons-js mapping can return (plus the dark variants CMM prefers
 * and its own overrides), writes VERSION and LICENSE.md, and generates
 * lib/icons/vscode-icon-names.ts so the client knows which icons exist.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CMM_ICON_OVERRIDES } from "../lib/icons/vscode-icon-overrides";

const projectRoot = path.resolve(__dirname, "..");
const targetDirectory = path.join(projectRoot, "public", "icons", "vscode");
const namesModulePath = path.join(projectRoot, "lib", "icons", "vscode-icon-names.ts");
const mappingDirectory = path.join(projectRoot, "node_modules", "vscode-icons-js", "dist");

function compareVersions(first: string, second: string): number {
  const firstParts = first.split(".").map(Number);
  const secondParts = second.split(".").map(Number);
  for (let partIndex = 0; partIndex < Math.max(firstParts.length, secondParts.length); partIndex += 1) {
    const difference = (firstParts[partIndex] ?? 0) - (secondParts[partIndex] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function findSourceDirectory(): { iconsDirectory: string; sourceVersion: string } {
  const fromIndex = process.argv.indexOf("--from");
  if (fromIndex !== -1) {
    const iconsDirectory = path.resolve(process.argv[fromIndex + 1] ?? "");
    return { iconsDirectory, sourceVersion: `from ${iconsDirectory}` };
  }
  const extensionsDirectory = path.join(homedir(), ".vscode", "extensions");
  const prefix = "vscode-icons-team.vscode-icons-";
  const installedVersions = existsSync(extensionsDirectory)
    ? readdirSync(extensionsDirectory)
        .filter((entryName) => entryName.startsWith(prefix))
        .map((entryName) => entryName.slice(prefix.length))
        .toSorted(compareVersions)
    : [];
  const newestVersion = installedVersions.at(-1);
  if (!newestVersion) {
    throw new Error("No vscode-icons extension in ~/.vscode/extensions. Pass --from <path to an icons folder>.");
  }
  return {
    iconsDirectory: path.join(extensionsDirectory, `${prefix}${newestVersion}`, "icons"),
    sourceVersion: `vscode-icons ${newestVersion} (VS Code extension)`,
  };
}

function readMappedIconNames(): Set<string> {
  const mappingSources = [path.join(mappingDirectory, "Index.js")];
  for (const generatedName of readdirSync(path.join(mappingDirectory, "generated"))) {
    if (generatedName.endsWith(".js")) mappingSources.push(path.join(mappingDirectory, "generated", generatedName));
  }
  const iconNames = new Set<string>();
  for (const mappingSource of mappingSources) {
    for (const iconName of readFileSync(mappingSource, "utf8").match(/[\w.-]+\.svg/g) ?? []) iconNames.add(iconName);
  }
  return iconNames;
}

function copyIcons(): void {
  const { iconsDirectory, sourceVersion } = findSourceDirectory();
  const availableSource = new Set(readdirSync(iconsDirectory));
  const wantedNames = readMappedIconNames();
  for (const iconName of [...wantedNames]) {
    if (iconName.includes("_light_")) wantedNames.add(iconName.replace("_light_", "_"));
    if (iconName.startsWith("folder_type_") && !iconName.endsWith("_opened.svg")) {
      wantedNames.add(iconName.replace(/\.svg$/, "_opened.svg"));
    }
  }
  for (const overrideName of Object.values(CMM_ICON_OVERRIDES)) wantedNames.add(overrideName);

  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true });
  const copiedNames: string[] = [];
  const missingNames: string[] = [];
  for (const iconName of [...wantedNames].toSorted()) {
    if (!/^[\w.-]+\.svg$/.test(iconName) || !availableSource.has(iconName)) {
      missingNames.push(iconName);
      continue;
    }
    copyFileSync(path.join(iconsDirectory, iconName), path.join(targetDirectory, iconName));
    copiedNames.push(iconName);
  }

  const mappingVersion = (
    JSON.parse(readFileSync(path.join(projectRoot, "node_modules", "vscode-icons-js", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  writeFileSync(
    path.join(targetDirectory, "VERSION"),
    [
      `icons: ${sourceVersion}`,
      `mapping: vscode-icons-js ${mappingVersion}`,
      `copied: ${copiedNames.length}`,
      `missing in the source (fall back to the default icons): ${missingNames.join(", ") || "none"}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(targetDirectory, "LICENSE.md"),
    [
      "# vscode-icons",
      "",
      "The icons in this folder come from [vscode-icons](https://github.com/vscode-icons/vscode-icons)",
      `(${sourceVersion}), by Roberto Huertas and the vscode-icons contributors.`,
      "",
      "They are licensed under the Creative Commons Attribution-ShareAlike 4.0 International license",
      "(CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/. CMM ships them unchanged. Each file",
      "remains under CC BY-SA 4.0; the CMM About page carries the same attribution.",
      "",
      "The file-name-to-icon mapping is vscode-icons-js (MIT), by Dominik Eckelmann.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    namesModulePath,
    [
      "/*",
      " * Generated by scripts/copy-vscode-icons.ts: the vscode-icons SVGs in public/icons/vscode/.",
      " * Do not edit; run the script again instead.",
      " */",
      `export const VSCODE_ICON_NAMES: ReadonlySet<string> = new Set(${JSON.stringify(copiedNames, undefined, 2)});`,
      "",
    ].join("\n"),
  );
  console.log(
    `[copy-vscode-icons] copied ${copiedNames.length} icons from ${sourceVersion}; ${missingNames.length} missing`,
  );
}

copyIcons();
