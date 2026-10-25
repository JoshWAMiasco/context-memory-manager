export interface Indentation {
  /** What one indent level inserts: a tab, or N spaces. */
  unit: string;
  /** How wide a tab is drawn. */
  tabSize: number;
}

const DEFAULT_INDENTATION: Indentation = { unit: "  ", tabSize: 4 };

/**
 * Guesses a file's indentation from its first 1,000 lines: tabs when more lines start
 * with a tab than with spaces, otherwise the most common step between indented lines (2, 4 or 8
 * spaces). Defaults to 2 spaces.
 *
 * @example
 * detectIndentation("if (a) {\n    b();\n}"); // { unit: "    ", tabSize: 4 }
 */
export function detectIndentation(text: string): Indentation {
  let tabLines = 0;
  let spaceLines = 0;
  const stepCounts = new Map<number, number>();
  let previousWidth = 0;
  for (const line of text.split("\n", 1000)) {
    if (line.trim() === "") continue;
    if (line.startsWith("\t")) {
      tabLines += 1;
      continue;
    }
    const width = /^ */.exec(line)?.[0].length ?? 0;
    if (width > 0) spaceLines += 1;
    const step = Math.abs(width - previousWidth);
    if (step === 2 || step === 4 || step === 8) stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1);
    previousWidth = width;
  }
  if (tabLines > spaceLines) return { unit: "\t", tabSize: 4 };
  if (stepCounts.size === 0) return DEFAULT_INDENTATION;
  const [mostCommonStep] = [...stepCounts].toSorted(
    (first, second) => second[1] - first[1] || first[0] - second[0],
  )[0] ?? [2];
  return { unit: " ".repeat(mostCommonStep), tabSize: mostCommonStep };
}
