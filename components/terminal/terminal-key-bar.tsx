"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, type LucideIcon } from "lucide-react";
import type { PointerEvent } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** The terminal keys a touch keyboard doesn't have, and what each sends to the shell. */
export type TerminalKey = "escape" | "tab" | "up" | "down" | "left" | "right" | "enter" | "interrupt";

/**
 * The bytes a key sends. Arrows follow the terminal's cursor key mode: full-screen programs (vim,
 * Claude Code's menus) switch to "application" mode, where they expect `ESC O A` rather than `ESC [ A`.
 *
 * @example
 * readTerminalKeySequence("up", terminal.modes.applicationCursorKeysMode); // "\x1bOA"
 */
export function readTerminalKeySequence(key: TerminalKey, isApplicationCursorMode: boolean): string {
  const arrowPrefix = isApplicationCursorMode ? "\x1bO" : "\x1b[";
  switch (key) {
    case "escape":
      return "\x1b";
    case "tab":
      return "\t";
    case "up":
      return `${arrowPrefix}A`;
    case "down":
      return `${arrowPrefix}B`;
    case "right":
      return `${arrowPrefix}C`;
    case "left":
      return `${arrowPrefix}D`;
    case "enter":
      return "\r";
    case "interrupt":
      return "\x03";
  }
}

/**
 * Ctrl held with what the touch keyboard typed: a single letter (or `@[\]^_`) becomes its control
 * character, anything else is sent as typed.
 *
 * @example
 * applyControlModifier("c"); // "\x03"
 */
export function applyControlModifier(data: string): string {
  if (data.length !== 1) return data;
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}

const KEYS: { key: TerminalKey; label: string; text?: string; icon?: LucideIcon }[] = [
  { key: "escape", label: "Escape", text: "Esc" },
  { key: "tab", label: "Tab", text: "Tab" },
  { key: "interrupt", label: "Ctrl+C", text: "^C" },
  { key: "left", label: "Left arrow", icon: ArrowLeft },
  { key: "up", label: "Up arrow", icon: ArrowUp },
  { key: "down", label: "Down arrow", icon: ArrowDown },
  { key: "right", label: "Right arrow", icon: ArrowRight },
  { key: "enter", label: "Enter", icon: CornerDownLeft },
];

const KEY_CLASS_NAMES =
  "flex h-9 max-w-14 min-w-8 flex-1 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-surface-strong px-1 font-mono text-xs text-foreground select-none active:bg-brand/25";

/** Keeps the focus (and the touch keyboard) in the terminal while a key is tapped. */
function keepFocus(pointerEvent: PointerEvent<HTMLButtonElement>) {
  pointerEvent.preventDefault();
}

/**
 * A row of keys under a terminal on touch screens: Esc, Tab, Ctrl (held for the next key typed),
 * ^C, the arrows and Enter, for programs that are driven by keys a phone keyboard lacks, such as
 * Claude Code's menus. Tapping a key doesn't take the focus from the terminal.
 *
 * @example
 * <TerminalKeyBar onKey={sendKey} isControlHeld={isControlHeld} onControlChange={setIsControlHeld} />
 */
export function TerminalKeyBar({
  onKey,
  isControlHeld,
  onControlChange,
}: {
  onKey: (key: TerminalKey) => void;
  isControlHeld: boolean;
  onControlChange: (isControlHeld: boolean) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className="flex flex-none gap-1 overflow-x-auto border-t border-line/60 bg-surface-subtle px-1.5 py-1.5"
      data-testid="terminal-key-bar"
    >
      {KEYS.slice(0, 2).map(({ key, label, text }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          data-testid={`terminal-key-${key}`}
          onPointerDown={keepFocus}
          onClick={() => onKey(key)}
          className={KEY_CLASS_NAMES}
        >
          {text}
        </button>
      ))}
      <button
        type="button"
        aria-label="Ctrl"
        aria-pressed={isControlHeld}
        data-testid="terminal-key-control"
        onPointerDown={keepFocus}
        onClick={() => onControlChange(!isControlHeld)}
        className={mergeClassNames(KEY_CLASS_NAMES, isControlHeld && "border-brand bg-brand/20 text-brand")}
      >
        Ctrl
      </button>
      {KEYS.slice(2).map(({ key, label, text, icon: KeyIcon }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          data-testid={`terminal-key-${key}`}
          onPointerDown={keepFocus}
          onClick={() => onKey(key)}
          className={KEY_CLASS_NAMES}
        >
          {KeyIcon ? <KeyIcon className="h-4 w-4 stroke-[1.75]" /> : text}
        </button>
      ))}
    </div>
  );
}
