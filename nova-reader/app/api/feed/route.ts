// GET /api/feed?url=<encoded-feed-url>
//
// Runs on the SERVER only (Next.js Route Handler, Node.js runtime).
// Browsers cannot download most feeds directly (CORS), so this route does it,
// with SSRF protection, limits and safe errors. All logic lives in
// lib/server/feed-handler.ts so it can be tested with fake DNS and network.
//
// Note: no `export const runtime` here. This project uses Cache Components,
// which always runs routes on Node.js and does not allow that export.

import { handleFeedRequest } from "@/lib/server/feed-handler";

export async function GET(request: Request): Promise<Response> {
  return handleFeedRequest(request);
}
