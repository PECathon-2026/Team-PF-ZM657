// Safe logging for the browser and the server (Stage 9). Runs on BOTH sides.
// Logs ONLY a scope, a stable code and a redacted one-line description — never
// stack traces, article text, full URLs (query strings can hold tokens), or
// secrets. There is no remote error reporting: logs stay in the console.

import { describeForLog, toAppError } from "./app-errors";

export function logError(scope: string, error: unknown, extra?: Record<string, string | number | boolean>): void {
  const { code } = toAppError(error);
  const details = extra ? ` ${JSON.stringify(extra).slice(0, 200)}` : "";
  console.error(`[nova:${scope}] ${code} ${describeForLog(error)}${details}`);
}
