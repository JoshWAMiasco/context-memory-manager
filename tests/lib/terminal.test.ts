import { describe, expect, it } from "vitest";
import { formatDroppedPaths, formatRunningTime, quoteShellPath, readShellQuoting } from "@/lib/terminal";

describe("readShellQuoting", () => {
  it("knows cmd.exe and PowerShell, and treats every other shell as POSIX", () => {
    expect(readShellQuoting("zsh")).toBe("posix");
    expect(readShellQuoting("bash")).toBe("posix");
    expect(readShellQuoting("fish")).toBe("posix");
    expect(readShellQuoting("cmd.exe")).toBe("cmd");
    expect(readShellQuoting("CMD.EXE")).toBe("cmd");
    expect(readShellQuoting("pwsh")).toBe("powershell");
    expect(readShellQuoting("powershell.exe")).toBe("powershell");
  });
});

describe("quoteShellPath for POSIX shells", () => {
  it("leaves a plain path alone", () => {
    expect(quoteShellPath("/srv/cmm/notes/today-1.md", "posix")).toBe("/srv/cmm/notes/today-1.md");
  });

  it("single-quotes spaces, globs, variables and other shell syntax", () => {
    expect(quoteShellPath("/srv/my notes/a.md", "posix")).toBe("'/srv/my notes/a.md'");
    expect(quoteShellPath("/srv/$HOME/*.md", "posix")).toBe("'/srv/$HOME/*.md'");
    expect(quoteShellPath("/srv/a;rm -rf ~", "posix")).toBe("'/srv/a;rm -rf ~'");
    expect(quoteShellPath("/srv/`id`", "posix")).toBe("'/srv/`id`'");
    expect(quoteShellPath("/srv/ünïcode/日本.md", "posix")).toBe("'/srv/ünïcode/日本.md'");
  });

  it("escapes a single quote by closing, escaping and reopening", () => {
    expect(quoteShellPath("/srv/it's/a.md", "posix")).toBe(String.raw`'/srv/it'\''s/a.md'`);
  });

  it("refuses control characters, which could run the line", () => {
    expect(quoteShellPath("/srv/a\nrm -rf ~", "posix")).toBeUndefined();
    expect(quoteShellPath("/srv/a\rb", "posix")).toBeUndefined();
    expect(quoteShellPath("/srv/a\u001B[2J", "posix")).toBeUndefined();
    expect(quoteShellPath("", "posix")).toBeUndefined();
  });
});

describe("quoteShellPath for Windows shells", () => {
  it("quotes PowerShell paths in single quotes, doubling quotes inside", () => {
    expect(quoteShellPath(String.raw`C:\Users\me\it's.md`, "powershell")).toBe(String.raw`'C:\Users\me\it''s.md'`);
  });

  it("double-quotes cmd.exe paths that need it, and refuses what cmd can't escape", () => {
    expect(quoteShellPath(String.raw`C:\notes\a.md`, "cmd")).toBe(String.raw`C:\notes\a.md`);
    expect(quoteShellPath(String.raw`C:\my notes\a&b.md`, "cmd")).toBe(String.raw`"C:\my notes\a&b.md"`);
    expect(quoteShellPath(String.raw`C:\%PATH%\a.md`, "cmd")).toBeUndefined();
  });
});

describe("formatDroppedPaths", () => {
  it("joins the quoted paths with spaces and ends with a space, never a newline", () => {
    const text = formatDroppedPaths(["/srv/a.md", "/srv/b c.md"], "posix");
    expect(text).toBe("/srv/a.md '/srv/b c.md' ");
    expect(text).not.toContain("\n");
  });

  it("throws when one of the paths can't be pasted safely", () => {
    expect(() => formatDroppedPaths(["/srv/a.md", "/srv/b\n.md"], "posix")).toThrow("can't be pasted");
  });
});

describe("formatRunningTime", () => {
  const startedAt = "2026-10-28T08:00:00Z";
  it("counts minutes, then hours and minutes, then days and hours", () => {
    expect(formatRunningTime(startedAt, Date.parse("2026-10-28T08:00:20Z"))).toBe("less than a minute");
    expect(formatRunningTime(startedAt, Date.parse("2026-10-28T08:42:59Z"))).toBe("42m");
    expect(formatRunningTime(startedAt, Date.parse("2026-10-28T10:14:30Z"))).toBe("2h 14m");
    expect(formatRunningTime(startedAt, Date.parse("2026-10-30T11:00:00Z"))).toBe("2d 3h");
  });

  it("never goes negative when the clocks disagree", () => {
    expect(formatRunningTime(startedAt, Date.parse("2026-10-28T07:59:00Z"))).toBe("less than a minute");
  });
});
