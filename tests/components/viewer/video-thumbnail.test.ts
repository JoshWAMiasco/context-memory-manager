import { describe, expect, it } from "vitest";
import { formatDuration } from "@/components/viewer/video-thumbnail";

describe("formatDuration", () => {
  it("shows minutes and seconds, with hours only when there are some", () => {
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(125.4)).toBe("2:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});
