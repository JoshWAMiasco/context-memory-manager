import { describe, expect, it, vi } from "vitest";
import { ServerEventsClient } from "@/lib/client/events";

/** A stand-in EventSource the test opens by hand. */
class FakeEventSource {
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(eventName: string, listener: () => void): void {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener]);
  }

  close(): void {}

  emit(eventName: string): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener();
  }
}

function createClient(): { client: ServerEventsClient; openLatest: () => void } {
  const eventSources: FakeEventSource[] = [];
  const client = new ServerEventsClient(() => {
    const eventSource = new FakeEventSource();
    eventSources.push(eventSource);
    return eventSource as unknown as EventSource;
  });
  return { client, openLatest: () => eventSources.at(-1)?.emit("open") };
}

describe("ServerEventsClient", () => {
  it("tells onOpen listeners each time the stream opens, so state missed while it was closed can be refetched", () => {
    vi.useFakeTimers();
    const { client, openLatest } = createClient();
    const openListener = vi.fn();
    const stopListening = client.onOpen(openListener);
    client.start();
    openLatest();
    expect(openListener).toHaveBeenCalledTimes(1);

    // A new watch reopens the stream with another URL: events sent in between are lost.
    client.watch("home", "notes");
    vi.runAllTimers();
    openLatest();
    expect(openListener).toHaveBeenCalledTimes(2);

    stopListening();
    client.watch("home", "other");
    vi.runAllTimers();
    openLatest();
    expect(openListener).toHaveBeenCalledTimes(2);
    client.stop();
    vi.useRealTimers();
  });
});
