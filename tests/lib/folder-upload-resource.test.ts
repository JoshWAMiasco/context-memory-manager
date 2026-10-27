import { describe, expect, it } from "vitest";
import { buildFolderUploadResource, isFolderUploadResource, readFolderUploadResource } from "@/lib/auth/policy";

describe("folder upload grants", () => {
  it("cover the folder and everything inside it", () => {
    expect(readFolderUploadResource("home", "import", "import")).toBe("home:import/**");
    expect(readFolderUploadResource("home", "import", "import/docs/2024")).toBe("home:import/**");
    expect(readFolderUploadResource("home", "", "anything/below")).toBe("home:/**");
    expect(isFolderUploadResource(buildFolderUploadResource("home", "import"))).toBe(true);
  });

  it("never cover a folder outside it, a sibling with the same prefix, or a path with . or ..", () => {
    expect(readFolderUploadResource("home", "import", "elsewhere")).toBeUndefined();
    expect(readFolderUploadResource("home", "import", "import-old")).toBeUndefined();
    expect(readFolderUploadResource("home", "import/docs", "import")).toBeUndefined();
    expect(readFolderUploadResource("home", "import", "import/../secrets")).toBeUndefined();
    expect(readFolderUploadResource("home", "import/..", "secrets")).toBeUndefined();
    expect(readFolderUploadResource("home", "import", "import/./docs")).toBeUndefined();
  });
});
