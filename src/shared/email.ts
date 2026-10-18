// Base stylesheet for sent email bodies. Inlined onto every element by juice
// at send time, and applied to the compose editor scoped under .editor so the
// preview renders exactly what recipients see.
export const EMAIL_CSS = `
  body { margin: 0; padding: 16px; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #000000; }
  h1 { font-size: 28px; font-weight: bold; margin: 0 0 16px; }
  h2 { font-size: 22px; font-weight: bold; margin: 0 0 12px; }
  h3 { font-size: 18px; font-weight: bold; margin: 0 0 10px; }
  p { margin: 0 0 16px; }
  div { margin: 0; }
  ul, ol { margin: 0 0 16px; padding-left: 24px; }
  li { margin: 0 0 4px; }
  a { color: #1a6ef5; text-decoration: underline; }
`;

// EMAIL_CSS with every selector scoped under .editor for the compose view.
export const EDITOR_CSS = EMAIL_CSS.split("}")
  .filter((rule) => rule.includes("{"))
  .map((rule) => {
    const [selectors, body] = rule.split("{");
    const scoped = selectors
      .split(",")
      .map((s) => (s.trim() === "body" ? ".editor" : `.editor ${s.trim()}`))
      .join(", ");
    return `${scoped} {${body}}`;
  })
  .join("\n");

// Block-level tags that pasted sources mark display:inline so they merge
// into the surrounding text flow (Google Docs wraps content this way).
// Replaced/void elements like <br>, <hr>, <img> are intentionally absent.
const INLINE_UNWRAP_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "DL", "DT", "DD", "BLOCKQUOTE", "PRE",
  "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "ASIDE",
  "FIGURE", "FIGCAPTION", "ADDRESS", "MAIN", "FIELDSET", "FORM", "TABLE",
]);

// Content pasted from Google Docs/Word arrives full of spans with explicit
// font styles, <b> wrappers marked font-weight:normal inside, ids, etc.
// Normalize to clean semantic tags so our email stylesheet controls the look.
// Requires a DOM (DOMParser) — runs in the webview.
export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.body;

  // Honor display intent before styles are stripped: an element marked
  // display:none was invisible in the editor and must not appear in the
  // email; a block marked display:inline flowed with surrounding text, so
  // splice it inline rather than leaving it as a real block. Without this,
  // pastes that looked like one line in the editor become separate,
  // margin-spaced paragraphs in the delivered mail.
  root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const display = el.style.display;
    if (display === "none") {
      el.remove();
    } else if (
      /^(inline|inline-block|contents)$/.test(display) &&
      INLINE_UNWRAP_TAGS.has(el.tagName)
    ) {
      el.replaceWith(...el.childNodes);
    }
  });

  // Convert styled spans into semantic tags before attributes are stripped
  root.querySelectorAll<HTMLElement>("span[style]").forEach((el) => {
    const s = el.style;
    const wrap = (tag: string) => {
      const w = doc.createElement(tag);
      w.append(...el.childNodes);
      el.append(w);
    };
    const weight = parseInt(s.fontWeight);
    if (s.fontWeight === "bold" || weight >= 600) wrap("b");
    if (s.fontStyle === "italic") wrap("i");
    if (s.textDecoration.includes("underline") && !el.closest("a")) wrap("u");
  });

  // Google Docs wraps blocks in <b> then resets weight on an inner span;
  // if a descendant marked non-bold covers all the text, drop the <b>.
  root.querySelectorAll("b, strong").forEach((b) => {
    const inner = b.querySelector<HTMLElement>("[style*='font-weight']");
    const fw = inner?.style.fontWeight;
    if (
      inner &&
      (fw === "normal" || fw === "400") &&
      inner.textContent?.trim() === b.textContent?.trim()
    ) {
      b.replaceWith(...b.childNodes);
    }
  });

  root
    .querySelectorAll("script, style, meta, link, title")
    .forEach((el) => el.remove());
  root
    .querySelectorAll("span, font")
    .forEach((el) => el.replaceWith(...el.childNodes));

  // Strip every attribute except a[href]
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (!(el.tagName === "A" && attr.name === "href")) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return root.innerHTML;
}
