/*
 * Copies the pdf.js files the PDF viewer loads at runtime into public/vendor/pdfjs/: the worker,
 * the Adobe CMaps and standard fonts (text in PDFs that don't embed their fonts), the ICC profile,
 * and the image decoders (JBIG2, JPEG 2000, colour management) as WebAssembly with JavaScript
 * fallbacks. The QuickJS engine pdf.js ships for running a PDF's own JavaScript is left out on
 * purpose: CMM never runs scripts from documents. `npm run dev` and `npm run build` run this, so
 * the copy always matches the installed pdfjs-dist; the output is not committed.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const sourceDirectory = path.join(projectRoot, "node_modules", "pdfjs-dist");
const targetDirectory = path.join(projectRoot, "public", "vendor", "pdfjs");

const { version } = JSON.parse(readFileSync(path.join(sourceDirectory, "package.json"), "utf8")) as { version: string };

rmSync(targetDirectory, { recursive: true, force: true });
mkdirSync(targetDirectory, { recursive: true });
cpSync(path.join(sourceDirectory, "build", "pdf.worker.min.mjs"), path.join(targetDirectory, "pdf.worker.min.mjs"));
for (const folder of ["cmaps", "standard_fonts", "iccs"]) {
  cpSync(path.join(sourceDirectory, folder), path.join(targetDirectory, folder), { recursive: true });
}
cpSync(path.join(sourceDirectory, "wasm"), path.join(targetDirectory, "wasm"), {
  recursive: true,
  filter: (sourcePath) => !path.basename(sourcePath).startsWith("quickjs"),
});
cpSync(path.join(sourceDirectory, "LICENSE"), path.join(targetDirectory, "LICENSE"));
writeFileSync(path.join(targetDirectory, "VERSION"), `${version}\n`);
console.log(`[copy-pdfjs-assets] pdfjs-dist ${version} → public/vendor/pdfjs`);
