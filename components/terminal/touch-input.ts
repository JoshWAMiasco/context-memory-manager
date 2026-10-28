import type { Terminal } from "@xterm/xterm";

/**
 * The bytes that turn what the shell got from `previous` into `next`: a DEL (`\x7f`, Backspace)
 * for each character after their common start, then the rest of `next`. A line break the
 * keyboard typed becomes Enter (`\r`).
 *
 * @example
 * readTextChange("claue", "claude "); // "\x7fde "
 */
export function readTextChange(previous: string, next: string): string {
  const previousCharacters = [...previous];
  const nextCharacters = [...next];
  let common = 0;
  while (
    common < previousCharacters.length &&
    common < nextCharacters.length &&
    previousCharacters[common] === nextCharacters[common]
  ) {
    common += 1;
  }
  const added = nextCharacters.slice(common).join("").replace(/\r?\n/g, "\r");
  return "\x7f".repeat(previousCharacters.length - common) + added;
}

/**
 * Typing on a phone keyboard into xterm's hidden text area. Android keyboards (Gboard, Samsung)
 * compose words, suggest and autocorrect by rewriting the text area, and xterm's own composition
 * handling sends those rewrites more than once ("claude" arrives as "claue claudecde"). Here the
 * text area's text is compared with what was sent before and only the difference goes to the
 * shell, as backspaces and new characters, so the line matches what the keyboard shows. Keys with
 * a real key code (a Bluetooth keyboard, Enter, the arrows) still go through xterm.
 *
 * Returns `reset`, for keys sent from elsewhere (the key bar) that change the line under the
 * keyboard, and `dispose`.
 *
 * @example
 * const touchInput = installTouchInput(container, terminal.textarea, (data) => send(data));
 */
export function installTouchInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  sendInput: (data: string) => void,
): { reset: () => void; dispose: () => void } {
  let sentText = textarea.value;

  const reset = () => {
    textarea.value = "";
    sentText = "";
  };
  const sendChange = () => {
    const change = readTextChange(sentText, textarea.value);
    sentText = textarea.value;
    if (change) sendInput(change);
    // A line break the keyboard typed ended the line: start the next one empty.
    if (change.endsWith("\r")) reset();
  };
  const isOwnEvent = (event: Event) => event.target === textarea;

  /*
   * Capture listeners on the container run before xterm's own on the text area; stopping the
   * event there keeps xterm from sending the same text again.
   */
  const handleComposition = (event: Event) => {
    if (!isOwnEvent(event)) return;
    event.stopPropagation();
    if (event.type === "compositionend") sendChange();
  };
  const handleInput = (event: Event) => {
    if (!isOwnEvent(event)) return;
    event.stopPropagation();
    const { inputType } = event as InputEvent;
    if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
      reset();
      sendInput("\r");
      return;
    }
    sendChange();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isOwnEvent(event)) return;
    // 229 is "the keyboard is composing": the text arrives with the input event.
    if (event.isComposing || event.keyCode === 229 || event.key === "Unidentified") {
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      reset();
      sendInput("\r");
      return;
    }
    if (event.key === "Backspace") {
      event.stopPropagation();
      // With text in the text area, deleting it there sends the backspace (as a change).
      if (textarea.value !== "") return;
      event.preventDefault();
      sendInput("\x7f");
    }
  };
  const handleFocus = (event: Event) => {
    if (isOwnEvent(event)) sentText = textarea.value;
  };

  const listeners: [string, EventListener][] = [
    ["compositionstart", handleComposition],
    ["compositionupdate", handleComposition],
    ["compositionend", handleComposition],
    ["input", handleInput],
    ["keydown", handleKeyDown as EventListener],
    ["focus", handleFocus],
  ];
  for (const [type, listener] of listeners) container.addEventListener(type, listener, true);
  return {
    reset,
    dispose: () => {
      for (const [type, listener] of listeners) container.removeEventListener(type, listener, true);
    },
  };
}

/** How far a finger moves before a touch counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PIXELS = 8;

/**
 * Scrolling a terminal by swiping on it. In a shell (and Claude Code, which draws in the normal
 * screen) the swipe moves through the scrollback a line per row height; full-screen programs
 * (less, vim, htop) get it as the scroll wheel, which xterm passes on to them. A tap still focuses
 * the terminal and opens the keyboard. Returns `dispose`.
 *
 * @example
 * const disposeSwipe = installSwipeScroll(container, terminal);
 */
export function installSwipeScroll(container: HTMLElement, terminal: Terminal): () => void {
  let lastY: number | undefined;
  let startY = 0;
  let isSwiping = false;
  /** Pixels swiped that don't make a whole line yet. */
  let pendingPixels = 0;

  const scrollBy = (deltaY: number, clientX: number, clientY: number) => {
    if (terminal.buffer.active.type === "normal") {
      const rowHeight = container.querySelector(".xterm-rows")?.clientHeight ?? 0;
      const lineHeight = rowHeight > 0 ? rowHeight / terminal.rows : 15;
      pendingPixels += deltaY;
      const lines = Math.trunc(pendingPixels / lineHeight);
      pendingPixels -= lines * lineHeight;
      if (lines !== 0) terminal.scrollLines(lines);
      return;
    }
    terminal.element?.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  /** The one finger on the screen; a pinch or two-finger touch isn't a swipe. */
  const readFinger = (event: TouchEvent) => (event.touches.length === 1 ? event.touches.item(0) : null);
  const handleTouchStart = (event: TouchEvent) => {
    const finger = readFinger(event);
    lastY = finger?.clientY;
    startY = finger?.clientY ?? 0;
    isSwiping = false;
    pendingPixels = 0;
  };
  const handleTouchMove = (event: TouchEvent) => {
    const finger = readFinger(event);
    if (lastY === undefined || !finger) return;
    const y = finger.clientY;
    if (!isSwiping && Math.abs(y - startY) < SWIPE_THRESHOLD_PIXELS) return;
    isSwiping = true;
    // The page stays put; the terminal scrolls instead.
    event.preventDefault();
    const deltaY = lastY - y;
    lastY = y;
    if (deltaY !== 0) scrollBy(deltaY, finger.clientX, y);
  };
  const handleTouchEnd = () => {
    lastY = undefined;
  };

  container.addEventListener("touchstart", handleTouchStart, { passive: true });
  container.addEventListener("touchmove", handleTouchMove, { passive: false });
  container.addEventListener("touchend", handleTouchEnd);
  container.addEventListener("touchcancel", handleTouchEnd);
  return () => {
    container.removeEventListener("touchstart", handleTouchStart);
    container.removeEventListener("touchmove", handleTouchMove);
    container.removeEventListener("touchend", handleTouchEnd);
    container.removeEventListener("touchcancel", handleTouchEnd);
  };
}
