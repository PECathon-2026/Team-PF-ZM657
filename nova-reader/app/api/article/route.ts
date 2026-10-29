// GET /api/article?url=<encoded-article-url>   (Stage 6)
//
// Runs on the SERVER only. Downloads one article page with the same SSRF
// protection as /api/feed and returns its raw HTML inside JSON. The browser
// extracts and sanitizes it. All logic is in lib/server/article-handler.ts.

import { handleArticleRequest } from "@/lib/server/article-handler";

export async function GET(request: Request): Promise<Response> {
  return handleArticleRequest(request);
}
