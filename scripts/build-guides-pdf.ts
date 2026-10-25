/*
 * Builds the two PDF guides from docs/guides/*.md, offline and from local files only:
 *
 *   1. Markdown → HTML with `marked`, plus CMM's extras: numbered chapters (`#`) and sections
 *      (`##`), GitHub-style callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!DANGER]`), numbered
 *      lists as step badges, and an image alone in a paragraph as a numbered figure.
 *   2. The HTML goes into docs/guides/pdf-layout/guide.html with guide.css, the fonts (Oxanium, Inter,
 *      Martian Mono) and every image inlined: SVG diagrams as markup, screenshots as data URIs
 *      (re-encoded in the page as JPEG at print resolution, which keeps the PDFs small).
 *   3. Playwright's Chromium prints it twice: the first PDF is only read back (pdf.js) to find the
 *      page each heading landed on, for the table of contents; the second is the guide, with links
 *      and a bookmark outline. The running title and page numbers are CSS page margin boxes.
 *
 * Output: dist/docs/CMM-Desktop-Guide.pdf and dist/docs/CMM-Server-Guide.pdf (and the HTML next to
 * them with `--html`). A missing screenshot or diagram fails the build unless `--allow-missing`.
 *
 * Usage: `npm run docs:pdf [-- --html] [-- --allow-missing] [-- desktop|server]`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { Marked, type Tokens } from "marked";

interface GuideDefinition {
  key: "desktop" | "server";
  source: string;
  output: string;
  whereToOpen: string;
}

interface Heading {
  depth: 1 | 2;
  number: string;
  title: string;
  id: string;
  markerId: string;
}

interface RenderedGuide {
  title: string;
  subtitle: string;
  html: string;
  headings: Heading[];
  missingAssets: string[];
}

const projectRoot = path.resolve(__dirname, "..");
const guidesDirectory = path.join(projectRoot, "docs", "guides");
const outputDirectory = path.join(projectRoot, "dist", "docs");
const layoutDirectory = path.join(guidesDirectory, "pdf-layout");

const GUIDES: GuideDefinition[] = [
  {
    key: "desktop",
    source: "desktop-guide.md",
    output: "CMM-Desktop-Guide.pdf",
    whereToOpen: "Help › Desktop Guide (PDF) in the app, or Settings › About",
  },
  {
    key: "server",
    source: "server-guide.md",
    output: "CMM-Server-Guide.pdf",
    whereToOpen: "Settings › About in CMM, or docs/CMM-Server-Guide.pdf in the server package",
  },
];

const FONTS = [
  { family: "Oxanium", file: "styles/fonts/oxanium-latin-variable-weight.woff2", weights: "200 800" },
  { family: "Martian Mono", file: "styles/fonts/martian-mono-latin-variable-weight.woff2", weights: "100 800" },
  {
    family: "Inter",
    file: "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    weights: "100 900",
  },
];

const CALLOUT_KINDS = {
  NOTE: {
    label: "Note",
    icon: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  },
  TIP: {
    label: "Tip",
    icon: '<path d="M9 18h6"/><path d="M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.6.5.8 1.1.8 1.7v.5h6v-.5c0-.6.2-1.2.8-1.7A6.5 6.5 0 0 0 12 2.5z"/>',
  },
  WARNING: {
    label: "Warning",
    icon: '<path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><path d="M12 17h.01"/>',
  },
  DANGER: {
    label: "Danger",
    icon: '<path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9z"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  },
} as const;

type CalloutKind = keyof typeof CALLOUT_KINDS;

const commandArguments = process.argv.slice(2);
const shouldWriteHtml = commandArguments.includes("--html");
const shouldAllowMissing = commandArguments.includes("--allow-missing");
const selectedKeys = commandArguments.filter((argument) => !argument.startsWith("--"));

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"]/g, (character) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[character]};`);
}

function decodeEntities(html: string): string {
  return html
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll(/&[a-z]+;/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function readFrontMatter(markdown: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) return { fields: {}, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex > 0) fields[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
  }
  return { fields, body: markdown.slice(match[0].length) };
}

/** The bytes of a file as a data URI. */
function toDataUri(filePath: string, mimeType: string): string {
  return `data:${mimeType};base64,${readFileSync(filePath).toString("base64")}`;
}

/** An SVG file's markup, ready to sit inline in the page (no XML prolog, scalable, labelled). */
function readInlineSvg(filePath: string, label: string): string {
  return readFileSync(filePath, "utf8")
    .replace(/<\?xml[^>]*\?>\s*/, "")
    .replace(/<!DOCTYPE[^>]*>\s*/i, "")
    .replace(/<svg\b/, `<svg role="img" aria-label="${escapeHtml(label)}"`);
}

function renderGuide(markdown: string): RenderedGuide {
  const { fields, body } = readFrontMatter(markdown);
  const headings: Heading[] = [];
  const missingAssets: string[] = [];
  const usedIds = new Set<string>();
  let chapterNumber = 0;
  let sectionNumber = 0;
  let figureNumber = 0;

  const uniqueId = (text: string) => {
    let candidate = toSlug(text) || "section";
    for (let suffix = 2; usedIds.has(candidate); suffix += 1) candidate = `${toSlug(text)}-${suffix}`;
    usedIds.add(candidate);
    return candidate;
  };

  const renderFigure = (href: string, caption: string): string => {
    figureNumber += 1;
    const assetPath = path.join(guidesDirectory, href);
    const captionHtml = `<figcaption><span class="figure-number">Figure ${figureNumber}.</span>${caption}</figcaption>`;
    if (!existsSync(assetPath)) {
      missingAssets.push(href);
      return `<figure><div class="missing-asset">Missing: ${escapeHtml(href)}</div>${captionHtml}</figure>`;
    }
    if (href.endsWith(".svg")) {
      return `<figure class="diagram">${readInlineSvg(assetPath, caption.replaceAll(/<[^>]+>/g, ""))}${captionHtml}</figure>`;
    }
    const alt = escapeHtml(caption.replaceAll(/<[^>]+>/g, ""));
    return `<figure class="screen"><img data-screen alt="${alt}" src="${toDataUri(assetPath, "image/png")}" />${captionHtml}</figure>`;
  };

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const titleHtml = this.parser.parseInline(tokens);
        const plainTitle = decodeEntities(titleHtml.replaceAll(/<[^>]+>/g, ""));
        if (depth === 1) {
          chapterNumber += 1;
          sectionNumber = 0;
          const heading: Heading = {
            depth: 1,
            number: String(chapterNumber),
            title: plainTitle,
            id: uniqueId(plainTitle),
            markerId: `cmmmark${headings.length}x`,
          };
          headings.push(heading);
          return `</section><section class="chapter"><header class="chapter-header"><div class="chapter-eyebrow">Chapter ${chapterNumber}</div><h1 id="${heading.id}"><span class="page-marker">${heading.markerId}</span>${titleHtml}</h1></header>`;
        }
        if (depth === 2) {
          sectionNumber += 1;
          const heading: Heading = {
            depth: 2,
            number: `${chapterNumber}.${sectionNumber}`,
            title: plainTitle,
            id: uniqueId(`${chapterNumber}-${plainTitle}`),
            markerId: `cmmmark${headings.length}x`,
          };
          headings.push(heading);
          return `<h2 id="${heading.id}"><span class="page-marker">${heading.markerId}</span><span class="section-number">${heading.number}</span>${titleHtml}</h2>`;
        }
        return `<h${depth}>${titleHtml}</h${depth}>`;
      },
      paragraph({ tokens }: Tokens.Paragraph) {
        const meaningful = tokens.filter((token) => !(token.type === "text" && token.raw.trim() === ""));
        if (meaningful.length === 1 && meaningful[0]?.type === "image") {
          const image = meaningful[0] as Tokens.Image;
          return renderFigure(image.href, this.parser.parseInline(image.tokens ?? []) || escapeHtml(image.text));
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const innerHtml = this.parser.parse(tokens);
        const match = /^<p>::callout-([a-z]+)::\s*/.exec(innerHtml);
        if (!match) return `<blockquote>${innerHtml}</blockquote>`;
        const kind = (match[1] ?? "note").toUpperCase() as CalloutKind;
        const callout = CALLOUT_KINDS[kind];
        const contentHtml = `<p>${innerHtml.slice(match[0].length)}`.replace(/^<p><\/p>\s*/, "");
        const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${callout.icon}</svg>`;
        return `<aside class="callout callout-${kind.toLowerCase()}"><div class="callout-label">${icon}${callout.label}</div>${contentHtml}</aside>`;
      },
      list(token: Tokens.List) {
        const itemsHtml = token.items.map((item) => this.listitem(item)).join("");
        if (!token.ordered) return `<ul>${itemsHtml}</ul>\n`;
        const start = typeof token.start === "number" ? token.start : 1;
        return `<ol class="steps" style="--step-start: ${start - 1}">${itemsHtml}</ol>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? "").trim();
        const label = language === "bash" || language === "sh" ? "Terminal" : language === "text" ? "" : language;
        return `<pre${label ? ` data-language="${escapeHtml(label)}"` : ""}><code>${escapeHtml(text)}</code></pre>\n`;
      },
    },
  });

  const calloutSource = body.replaceAll(/^>\s*\[!(NOTE|TIP|WARNING|DANGER)\]\s*$/gm, (_line, kind: string) => {
    return `> ::callout-${kind.toLowerCase()}::`;
  });
  const html = `<section>${marked.parse(calloutSource, { async: false })}</section>`.replace("<section></section>", "");
  return {
    title: fields.title ?? "CMM Guide",
    subtitle: fields.subtitle ?? "",
    html,
    headings,
    missingAssets,
  };
}

function renderTableOfContents(headings: readonly Heading[], pages: ReadonlyMap<string, number>): string {
  const entry = (heading: Heading) =>
    `<div class="toc-entry"><span class="toc-number">${heading.number}</span><a href="#${heading.id}">${escapeHtml(heading.title)}</a><span class="toc-leader"></span><span class="toc-page">${pages.get(heading.markerId) ?? ""}</span></div>`;
  const chapters: string[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const chapter = headings[index];
    if (!chapter || chapter.depth !== 1) continue;
    const sections: Heading[] = [];
    for (let next = index + 1; next < headings.length && headings[next]?.depth === 2; next += 1) {
      sections.push(headings[next] as Heading);
    }
    const sectionList =
      sections.length > 0
        ? `<ol class="toc-sections">${sections.map((section) => `<li>${entry(section)}</li>`).join("")}</ol>`
        : "";
    chapters.push(`<li class="toc-chapter">${entry(chapter)}${sectionList}</li>`);
  }
  return `<ol>${chapters.join("")}</ol>`;
}

function buildFontFaces(): string {
  return FONTS.map(
    (font) =>
      `@font-face { font-family: "${font.family}"; src: url("${toDataUri(path.join(projectRoot, font.file), "font/woff2")}") format("woff2"); font-weight: ${font.weights}; font-style: normal; font-display: block; }`,
  ).join("\n");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function buildDocument(
  guide: GuideDefinition,
  rendered: RenderedGuide,
  pages: ReadonlyMap<string, number>,
  { keepMarkers }: { keepMarkers: boolean },
): string {
  const version = (JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { version: string })
    .version;
  const buildDate = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000) : new Date();
  const logo = readFileSync(path.join(projectRoot, "public", "icons", "cmm", "logo.svg"), "utf8")
    .replace(/ width="\d+" height="\d+"/, "")
    .replaceAll("cmm-logo-fill", "cover-logo-fill");
  const content = keepMarkers
    ? rendered.html
    : rendered.html.replaceAll(/<span class="page-marker">[^<]*<\/span>/g, "");
  const replacements: Record<string, string> = {
    title: escapeHtml(rendered.title),
    subtitle: escapeHtml(rendered.subtitle),
    version: escapeHtml(version),
    date: escapeHtml(formatDate(buildDate)),
    whereToOpen: escapeHtml(guide.whereToOpen),
    fontFaces: buildFontFaces(),
    stylesheet: `${readFileSync(path.join(layoutDirectory, "guide.css"), "utf8")}\n@page { @bottom-left { content: "${rendered.title.replaceAll('"', "")}"; } }\n@page :first { @bottom-left { content: none; } }`,
    logo,
    toc: renderTableOfContents(rendered.headings, pages),
    content,
  };
  return readFileSync(path.join(layoutDirectory, "guide.html"), "utf8").replaceAll(
    /\{\{(\w+)\}\}/g,
    (placeholder, name: string) => replacements[name] ?? placeholder,
  );
}

/** Re-encodes every screenshot as a JPEG at print resolution (at most 1,700 px wide), in the page. */
async function compressScreenshots(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>("img[data-screen]")];
    for (const image of images) {
      await image.decode();
      const width = Math.min(image.naturalWidth, 1700);
      const height = Math.round((image.naturalHeight * width) / image.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      image.src = canvas.toDataURL("image/jpeg", 0.86);
      await image.decode();
    }
  });
}

async function printPdf(page: Page, html: string): Promise<Buffer> {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await compressScreenshots(page);
  return page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    outline: true,
    tagged: true,
  });
}

/** The page (1-based) on which each heading marker appears in a printed PDF. */
async function findMarkerPages(pdfBytes: Buffer): Promise<Map<string, number>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false });
  const document = await loadingTask.promise;
  const pages = new Map<string, number>();
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const textContent = await (await document.getPage(pageNumber)).getTextContent();
    const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).join("");
    for (const match of pageText.matchAll(/cmmmark\d+x/g)) {
      if (!pages.has(match[0])) pages.set(match[0], pageNumber);
    }
  }
  await loadingTask.destroy();
  return pages;
}

async function buildGuidePdf(page: Page, guide: GuideDefinition): Promise<{ pages: number; bytes: number }> {
  const rendered = renderGuide(readFileSync(path.join(guidesDirectory, guide.source), "utf8"));
  if (rendered.missingAssets.length > 0) {
    const message = `${guide.source} refers to missing files:\n  ${rendered.missingAssets.join("\n  ")}`;
    if (!shouldAllowMissing) throw new Error(`${message}\n(--allow-missing builds with placeholders)`);
    console.warn(`[docs:pdf] ${message}`);
  }
  // Pass 1 prints with empty page numbers, only to see where each heading lands.
  const draft = await printPdf(page, buildDocument(guide, rendered, new Map(), { keepMarkers: true }));
  const markerPages = await findMarkerPages(draft);
  const unplaced = rendered.headings.filter((heading) => !markerPages.has(heading.markerId));
  if (unplaced.length > 0)
    throw new Error(`Couldn't find the page of: ${unplaced.map((heading) => heading.title).join(", ")}`);
  const finalHtml = buildDocument(guide, rendered, markerPages, { keepMarkers: false });
  const pdfBytes = await printPdf(page, finalHtml);
  writeFileSync(path.join(outputDirectory, guide.output), pdfBytes);
  if (shouldWriteHtml) writeFileSync(path.join(outputDirectory, guide.output.replace(/\.pdf$/, ".html")), finalHtml);
  const pageCount = Math.max(...markerPages.values());
  return { pages: pageCount, bytes: pdfBytes.length };
}

async function main(): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  const guides = GUIDES.filter((guide) => selectedKeys.length === 0 || selectedKeys.includes(guide.key));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Nothing in the guides may come from the network: every asset is inlined.
    await page.route(/^(?!data:|about:)/, (route) => route.abort());
    for (const guide of guides) {
      const startedAt = Date.now();
      const result = await buildGuidePdf(page, guide);
      console.log(
        `[docs:pdf] ${guide.output}: ${(result.bytes / 1024 / 1024).toFixed(1)} MB, last heading on page ${result.pages}, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((buildError: unknown) => {
  console.error(`[docs:pdf] ${buildError instanceof Error ? buildError.message : String(buildError)}`);
  process.exit(1);
});
