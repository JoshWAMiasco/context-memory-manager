/*
 * Generates the desktop app's icons from public/icons/cmm/logo.svg:
 *
 *   build/icon.icns            macOS (PNG entries 16 … 1024, including the @2x sizes)
 *   build/icon.ico             Windows (PNG entries 16 … 256)
 *   build/icons/<n>x<n>.png    Linux (16 … 1024), the layout electron-builder expects
 *   build/icon.png             1024 px, the fallback electron-builder reads
 *
 * The SVG is rendered by Playwright's Chromium (already a dev dependency), and the ICNS and ICO
 * containers are written here, so no image tool is needed. Run `npm run icons:app` after changing
 * the logo, and commit the output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..");
const logoPath = path.join(projectRoot, "public", "icons", "cmm", "logo.svg");
const buildDirectory = path.join(projectRoot, "build");
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICNS entry types holding PNG data, with their pixel size. */
const ICNS_ENTRIES: [type: string, size: number][] = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];

async function renderPngs(): Promise<Map<number, Buffer>> {
  const logoDataUrl = `data:image/svg+xml;base64,${readFileSync(logoPath).toString("base64")}`;
  const browser = await chromium.launch();
  const renderedPngs = new Map<number, Buffer>();
  try {
    const page = await browser.newPage();
    for (const size of PNG_SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<html><body style="margin:0;background:transparent"><img src="${logoDataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`,
      );
      await page.locator("img").evaluate((image: HTMLImageElement) => image.decode());
      renderedPngs.set(size, await page.screenshot({ omitBackground: true, type: "png" }));
    }
  } finally {
    await browser.close();
  }
  return renderedPngs;
}

function readPng(renderedPngs: Map<number, Buffer>, size: number): Buffer {
  const png = renderedPngs.get(size);
  if (!png) throw new Error(`No ${size} px rendering`);
  return png;
}

function buildIcns(renderedPngs: Map<number, Buffer>): Buffer {
  const entries = ICNS_ENTRIES.map(([type, size]) => {
    const png = readPng(renderedPngs, size);
    const entryHeader = Buffer.alloc(8);
    entryHeader.write(type, 0, "ascii");
    entryHeader.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([entryHeader, png]);
  });
  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, "ascii");
  fileHeader.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([fileHeader, ...entries]);
}

function buildIco(renderedPngs: Map<number, Buffer>): Buffer {
  const fileHeader = Buffer.alloc(6);
  fileHeader.writeUInt16LE(0, 0);
  fileHeader.writeUInt16LE(1, 2);
  fileHeader.writeUInt16LE(ICO_SIZES.length, 4);
  const directory = Buffer.alloc(16 * ICO_SIZES.length);
  let imageOffset = fileHeader.length + directory.length;
  const images = ICO_SIZES.map((size, index) => {
    const png = readPng(renderedPngs, size);
    const entryOffset = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(png.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += png.length;
    return png;
  });
  return Buffer.concat([fileHeader, directory, ...images]);
}

async function generateIcons(): Promise<void> {
  const renderedPngs = await renderPngs();
  mkdirSync(path.join(buildDirectory, "icons"), { recursive: true });
  for (const size of PNG_SIZES) {
    writeFileSync(path.join(buildDirectory, "icons", `${size}x${size}.png`), readPng(renderedPngs, size));
  }
  writeFileSync(path.join(buildDirectory, "icon.png"), readPng(renderedPngs, 1024));
  writeFileSync(path.join(buildDirectory, "icon.icns"), buildIcns(renderedPngs));
  writeFileSync(path.join(buildDirectory, "icon.ico"), buildIco(renderedPngs));
  console.log(`[gen-app-icons] wrote build/icon.icns, build/icon.ico and ${PNG_SIZES.length} PNGs`);
}

generateIcons().catch((iconError: unknown) => {
  console.error(iconError);
  process.exit(1);
});
