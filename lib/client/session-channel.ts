/*
 * Cross-tab session messages over BroadcastChannel("ccm-session"): activity in one tab keeps the
 * others awake, and locking or signing out in one tab sends every tab to the right page.
 */

export type SessionChannelMessage = { type: "activity" } | { type: "locked" } | { type: "signed-out" };

const CHANNEL_NAME = "ccm-session";

/** Opens the channel, or returns undefined where BroadcastChannel isn't available. */
export function openSessionChannel(): BroadcastChannel | undefined {
  return typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL_NAME);
}

export function postSessionMessage(message: SessionChannelMessage): void {
  const sessionChannel = openSessionChannel();
  sessionChannel?.postMessage(message);
  sessionChannel?.close();
}

/** The current page as a `?next=` value, so locking or signing in returns here. */
export function readCurrentPagePath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

let isLeavingPage = false;

/**
 * Marks the page as leaving before a sign-out or lock request, so the server's "session ended"
 * event, which can arrive before the response, doesn't send the tab elsewhere first.
 */
export function beginLeavingPage(): void {
  isLeavingPage = true;
}

/**
 * Navigates with a full page load. Used whenever the session changes (sign-in, unlock, lock, sign
 * out): the server re-renders with the new cookie and no client state from the old session survives.
 */
export function navigateWithFullReload(pagePath: string): void {
  isLeavingPage = true;
  window.location.assign(pagePath);
}

/**
 * Leaves for `/lock` or `/login`, remembering the current page. Does nothing once the page is
 * already leaving: after Sign out, the "session ended" server event must not replace the
 * navigation to /login with one that carries `?next=`.
 */
export function goToSessionPage(pagePath: "/lock" | "/login"): void {
  if (isLeavingPage) return;
  const currentPagePath = readCurrentPagePath();
  const shouldKeepNext = !["/lock", "/login", "/setup"].includes(window.location.pathname);
  navigateWithFullReload(shouldKeepNext ? `${pagePath}?next=${encodeURIComponent(currentPagePath)}` : pagePath);
}
