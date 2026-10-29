// Cheap safety check that runs BEFORE untrusted HTML is parsed.
// Used in the BROWSER by lib/sanitize-html.ts and lib/article-extractor.ts.
//
// Why: browsers parse very deeply nested HTML slowly. Chromium caps the DOM depth
// at about 512 levels, and beyond that parsing becomes roughly quadratic:
// 16,000 nested <div>s take more than a second, and a 3 MB page of them can
// freeze the tab for minutes. Real articles nest a few dozen levels at most, so
// anything deeper than MAX_HTML_NESTING_DEPTH is treated as "too complex".
//
// The check reads the text once, from left to right, with indexOf only (no
// regular expressions that could backtrack), so it is fast even for 3 MB.

/** Deeper markup than this is refused. Below Chromium's ~512 cap, where parsing is still fast. */
export const MAX_HTML_NESTING_DEPTH = 500;

// Tags that never have a closing tag, or whose closing tag is often left out in
// valid HTML (<p>, <li>, <td>…). Counting them would overestimate the depth of
// ordinary pages, so they are ignored.
const NOT_COUNTED = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  "p", "li", "dt", "dd", "option", "optgroup", "tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "caption",
  "rb", "rt", "rtc", "rp", "html", "head", "body",
]);

// Their content is text, not markup (e.g. "<div>" inside a script is not a tag).
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe", "noembed", "noframes"]);

/**
 * True if the HTML opens more than `maxDepth` nested elements at some point.
 * This is an estimate: well-formed HTML gives its exact depth, and broken HTML
 * can only look deeper, never shallower, than the browser would build it
 * (the browser's depth cap only flattens what is deeper).
 */
export function isHtmlTooDeeplyNested(html: string, maxDepth = MAX_HTML_NESTING_DEPTH): boolean {
  let depth = 0;
  let position = 0;
  const lower = html.toLowerCase();

  while (position < html.length) {
    const start = html.indexOf("<", position);
    if (start === -1) return false;

    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end === -1) return false; // the rest is one comment
      position = end + 3;
      continue;
    }

    const end = html.indexOf(">", start + 1);
    if (end === -1) return false; // no complete tag left

    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(start, Math.min(end + 1, start + 64)));
    position = end + 1;
    if (!match) continue; // "<!doctype", "< 3", "<?xml" …

    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (NOT_COUNTED.has(name)) continue;

    if (closing) {
      depth = Math.max(0, depth - 1);
    } else if (html[end - 1] !== "/") {
      depth += 1;
      if (depth > maxDepth) return true;
      if (RAW_TEXT.has(name)) {
        // Skip to the matching closing tag; the content is not markup.
        const close = lower.indexOf(`</${name}`, position);
        if (close === -1) return false;
        position = close;
      }
    }
  }
  return false;
}
