"use client";
// Shows an article's HTML (with working links) inside the reader view.
// Runs in the BROWSER.
//
// We do NOT use dangerouslySetInnerHTML. Instead, DOMPurify returns a cleaned
// DocumentFragment, and we place it into an empty <div> ourselves.
// Sanitizing happens on every display, so articles saved earlier are cleaned
// with the current rules too.

import { useEffect, useRef } from "react";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";

type ArticleContentProps = {
  html: string; // untrusted contentHtml from the feed
  baseUrl: string; // the article's URL, for resolving relative links
};

export function ArticleContent({ html, baseUrl }: ArticleContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.replaceChildren(sanitizeArticleHtml(html, baseUrl));
  }, [html, baseUrl]);

  return <div ref={containerRef} className="article-content mt-6 font-serif text-lg leading-8" />;
}
