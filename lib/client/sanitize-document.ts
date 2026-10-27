/*
 * Makes a rendered Word document inert: docx-preview builds the DOM from the file's XML, which is
 * untrusted input shown in CMM's own page.
 */

/** Elements a document has no business adding to the page. */
const REMOVED_ELEMENTS =
  "script, iframe, frame, frameset, object, embed, link, meta, base, form, input, button, textarea, select";

const URL_ATTRIBUTES = ["href", "src", "xlink:href", "action", "formaction", "poster", "background"];

function isSafeLink(value: string): boolean {
  return /^(https?:|mailto:|#)/i.test(value.trim());
}

function isSafeImageSource(value: string): boolean {
  return /^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);|blob:)/i.test(value.trim());
}

/**
 * Strips everything that could run or load from a rendered document: script, frames, objects,
 * forms and `<link>`/`<meta>`/`<base>`; every `on…` handler; and any URL that isn't an http(s),
 * mailto or in-document link (`href`) or an embedded image (`src`). `srcset` and `srcdoc` go too.
 *
 * @example
 * await renderAsync(buffer, container);
 * sanitizeRenderedDocument(container);
 */
export function sanitizeRenderedDocument(root: Element): void {
  for (const element of root.querySelectorAll(REMOVED_ELEMENTS)) element.remove();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (!URL_ATTRIBUTES.includes(name)) continue;
      const isAllowed =
        element.tagName.toLowerCase() === "img" && name === "src"
          ? isSafeImageSource(attribute.value)
          : (name === "href" || name === "xlink:href") && isSafeLink(attribute.value);
      if (!isAllowed) element.removeAttribute(attribute.name);
    }
  }
}
