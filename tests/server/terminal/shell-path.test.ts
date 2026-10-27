import { describe, expect, it } from "vitest";
import { withUserBinOnPath } from "@/server/terminal/shell-path";

const exists = () => true;
const missing = () => false;

describe("withUserBinOnPath", () => {
  it("puts ~/.local/bin first when it exists, so the cmm user's claude is found", () => {
    expect(withUserBinOnPath("/usr/local/bin:/usr/bin:/bin", "/var/lib/cmm", exists)).toBe(
      "/var/lib/cmm/.local/bin:/usr/local/bin:/usr/bin:/bin",
    );
  });

  it("leaves PATH alone when the folder is missing or already on it", () => {
    expect(withUserBinOnPath("/usr/bin:/bin", "/var/lib/cmm", missing)).toBe("/usr/bin:/bin");
    expect(withUserBinOnPath("/usr/bin:/var/lib/cmm/.local/bin", "/var/lib/cmm", exists)).toBe(
      "/usr/bin:/var/lib/cmm/.local/bin",
    );
  });

  it("works without a PATH or a home folder", () => {
    expect(withUserBinOnPath(undefined, "/var/lib/cmm", exists)).toBe("/var/lib/cmm/.local/bin");
    expect(withUserBinOnPath("/usr/bin", undefined, exists)).toBe("/usr/bin");
  });
});
