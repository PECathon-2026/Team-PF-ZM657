// Placeholder for FUTURE local AI features. It does nothing on purpose.
// Runs in the BROWSER. No AI API is called and no content is sent anywhere.
// See README → "Future Local AI Architecture" for the plan.

import { FileText, MessageSquareText, Search, Sparkles, type LucideIcon } from "lucide-react";

const PLANNED_FEATURES: { title: string; description: string; icon: LucideIcon }[] = [
  { title: "Summarize locally", description: "Short summaries generated on your device.", icon: FileText },
  { title: "Find related saved articles", description: "Private search by meaning, not just keywords.", icon: Search },
  { title: "Ask questions about saved articles", description: "Answers from your own reading list.", icon: MessageSquareText },
];

export function AIWorkspacePlaceholder() {
  return (
    <section aria-labelledby="ai-title" className="rounded-2xl border border-dashed border-line p-4">
      <h2 id="ai-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Sparkles aria-hidden="true" className="size-5 text-ink-muted" />
        Local AI workspace
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">Planned</span>
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Local AI features will be added in a future version.</p>

      <ul className="mt-3 space-y-2">
        {PLANNED_FEATURES.map(({ title, description, icon: Icon }) => (
          <li
            key={title}
            className="flex items-start gap-3 rounded-lg bg-surface-muted/70 p-3 opacity-70"
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <div>
              <p className="text-sm font-medium text-ink">
                {title} <span className="sr-only">(not available yet)</span>
              </p>
              <p className="text-xs text-ink-muted">{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
