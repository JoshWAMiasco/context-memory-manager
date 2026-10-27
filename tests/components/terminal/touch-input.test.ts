import { describe, expect, it } from "vitest";
import { readTextChange } from "@/components/terminal/touch-input";

describe("readTextChange", () => {
  it("sends only what a keyboard added", () => {
    expect(readTextChange("", "c")).toBe("c");
    expect(readTextChange("cla", "clau")).toBe("u");
  });

  it("backspaces over what autocorrect rewrote, then types the correction", () => {
    expect(readTextChange("claue", "claude ")).toBe("\x7fde ");
    expect(readTextChange("--dangerous", "--dangerously")).toBe("ly");
  });

  it("backspaces deleted characters, counting emoji as one", () => {
    expect(readTextChange("ls -l", "ls -")).toBe("\x7f");
    expect(readTextChange("hi 👍", "hi ")).toBe("\x7f");
  });

  it("turns a typed line break into Enter", () => {
    expect(readTextChange("ls", "ls\n")).toBe("\r");
  });

  it("sends nothing when the text didn't change", () => {
    expect(readTextChange("same", "same")).toBe("");
  });
});
