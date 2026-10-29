// Any unknown /api/... path (Stage 9). Runs on the SERVER.
// Returns the same safe JSON error shape as the real routes instead of an HTML
// page, for every method. /api/feed and /api/article are more specific routes
// and are not affected.

import { errorJson } from "@/lib/server/responses";

function notFound(): Response {
  return errorJson("NOT_FOUND", 404, "This API endpoint does not exist.");
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
