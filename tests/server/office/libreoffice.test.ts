import { describe, expect, it } from "vitest";
import { parseLibreOfficeVersion } from "@/server/office/libreoffice";

describe("parseLibreOfficeVersion", () => {
  it("reads the version soffice --version prints", () => {
    expect(parseLibreOfficeVersion("LibreOffice 24.2.7.2 420(Build:2)\n")).toBe("24.2.7.2");
    expect(parseLibreOfficeVersion("LibreOffice 7.3.7.2 30(Build:2)")).toBe("7.3.7.2");
    expect(parseLibreOfficeVersion("command not found")).toBeUndefined();
  });
});
