// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeRenderedDocument } from "@/lib/client/sanitize-document";

describe("sanitizeRenderedDocument", () => {
  it("removes what could run or load, and keeps the document", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section class="docx">
        <p onclick="alert(1)" style="color:red">Hello <a href="javascript:alert(2)">bad link</a>
          <a href="https://example.com/doc">good link</a> <a href="#heading">jump</a></p>
        <img src="data:image/png;base64,AAAA" onerror="alert(3)" alt="ok">
        <img src="https://tracker.example/pixel.gif" alt="remote">
        <iframe srcdoc="<script>alert(4)</script>"></iframe>
        <script>alert(5)</script>
        <object data="evil.swf"></object>
        <svg><a xlink:href="javascript:alert(6)">x</a></svg>
        <form action="https://evil.example"><input name="q"></form>
      </section>`;
    sanitizeRenderedDocument(root);
    expect(root.querySelector("script, iframe, object, form, input")).toBeNull();
    expect(root.querySelector("[onclick], [onerror]")).toBeNull();
    const links = [...root.querySelectorAll("a")].map(
      (link) => link.getAttribute("href") ?? link.getAttribute("xlink:href"),
    );
    expect(links).toEqual([null, "https://example.com/doc", "#heading", null]);
    const images = [...root.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(images).toEqual(["data:image/png;base64,AAAA", null]);
    expect(root.textContent).toContain("Hello");
    expect(root.querySelector("p")?.getAttribute("style")).toBe("color:red");
  });
});
