/*
 * What the rich Markdown editor would lose. TipTap parses Markdown into its own document
 * model, so constructs it has no node for are dropped or rewritten on save. Files that use them
 * open in Source mode instead. Isomorphic and dependency-free, so it runs in unit tests.
 */

export interface FrontmatterSplit {
  /** The frontmatter block exactly as written, delimiters and final line break included; "" when there is none. */
  frontmatter: string;
  /** The YAML between the delimiters. */
  yaml: string;
  /** Everything after the frontmatter. */
  body: string;
}

const FRONTMATTER_PATTERN = /^---[ \t]*\n([\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;

/**
 * Splits YAML frontmatter (`---` at the very top, closed by `---` or `...`) from the Markdown body,
 * so it can be shown as metadata and re-attached unchanged on save.
 *
 * @example
 * splitFrontmatter("---\ntitle: Notes\n---\n# Hi\n"); // { frontmatter: "---\ntitle: Notes\n---\n", yaml: "title: Notes\n", body: "# Hi\n" }
 */
export function splitFrontmatter(markdown: string): FrontmatterSplit {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(markdown);
  if (!frontmatterMatch) return { frontmatter: "", yaml: "", body: markdown };
  const frontmatter = frontmatterMatch[0];
  return { frontmatter, yaml: frontmatterMatch[1] ?? "", body: markdown.slice(frontmatter.length) };
}

export type FidelityRisk = "raw-html" | "html-comment" | "footnote" | "reference-link" | "math";

export const FIDELITY_RISK_LABELS: Record<FidelityRisk, string> = {
  "raw-html": "HTML",
  "html-comment": "HTML comments",
  footnote: "footnotes",
  "reference-link": "reference-style links",
  math: "math",
};

const FENCED_CODE_PATTERN = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE_PATTERN = /(`+)[^`\n][\s\S]*?\1/g;

/** Removes code (fenced blocks and inline spans), where markup-like text is just text. */
function stripCode(markdown: string): string {
  return markdown.replaceAll(FENCED_CODE_PATTERN, "").replaceAll(INLINE_CODE_PATTERN, "");
}

const RISK_PATTERNS: [FidelityRisk, RegExp][] = [
  ["html-comment", /<!--/],
  ["raw-html", /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/],
  ["footnote", /\[\^[^\]\s]+\]/],
  ["reference-link", /^ {0,3}\[[^\]^][^\]]*\]:[ \t]*\S/m],
  ["math", /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|(?:^|[^\\$\w])\$(?=\S)[^$\n]*?\S\$(?![\w$])/m],
];

/**
 * Lists the constructs in `markdown` that the rich editor would lose: raw HTML, HTML comments,
 * footnotes, reference-style link definitions and math. Code blocks and inline code are ignored.
 * Autolinks (`<https://…>`) are not HTML.
 *
 * @example
 * findFidelityRisks("Hello <b>world</b>"); // ["raw-html"]
 */
export function findFidelityRisks(markdown: string): FidelityRisk[] {
  const prose = stripCode(splitFrontmatter(markdown).body);
  return RISK_PATTERNS.filter(([, pattern]) => pattern.test(prose)).map(([risk]) => risk);
}
