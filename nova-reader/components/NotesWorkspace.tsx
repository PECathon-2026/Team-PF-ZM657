"use client";
// Personal Note-Making Workspace & Per-Article Notes Pad.
// Stored 100% locally in IndexedDB (lib/db.ts `notes` table).

import { useEffect, useState, type FormEvent } from "react";
import { Check, Download, ExternalLink, NotebookPen, Plus, Trash2 } from "lucide-react";
import { deleteNote, getNotesForArticle, saveNote } from "@/lib/db";
import type { ReaderNote } from "@/lib/feed-types";
import { formatDate } from "@/lib/utils";

type NotesPanelProps = {
  notes: ReaderNote[];
  onRefresh: () => void;
};

export function NotesPanel({ notes, onRefresh }: NotesPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startNewNote() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setIsCreating(true);
    setError(null);
  }

  function startEditNote(note: ReaderNote) {
    setIsCreating(true);
    setEditingId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setError(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() && !content.trim()) return;
    try {
      const existing = editingId ? notes.find((n) => n.id === editingId) : undefined;
      await saveNote({
        id: editingId ?? undefined,
        title: title.trim() || content.trim().split("\n")[0]?.slice(0, 60) || "Reading note",
        content,
        articleUrl: existing?.articleUrl,
        articleTitle: existing?.articleTitle,
        createdAt: existing?.createdAt,
      });
      setIsCreating(false);
      setEditingId(null);
      setTitle("");
      setContent("");
      setError(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteNote(id);
      if (editingId === id) {
        setIsCreating(false);
        setEditingId(null);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete note.");
    }
  }

  function exportNotesMarkdown() {
    if (notes.length === 0) return;
    const md = notes
      .map((n) => {
        const header = `## ${n.title}`;
        const meta = n.articleTitle
          ? `_Source: [${n.articleTitle}](${n.articleUrl ?? ""}) · ${formatDate(n.updatedAt) ?? n.updatedAt}_`
          : `_Updated: ${formatDate(n.updatedAt) ?? n.updatedAt}_`;
        return `${header}\n${meta}\n\n${n.content}\n`;
      })
      .join("\n---\n\n");

    const blob = new Blob([`# NOVA Reader Notes\n\n${md}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nova-reader-notes-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const filtered = searchQuery.trim()
    ? notes.filter((n) =>
        `${n.title} ${n.content} ${n.articleTitle ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : notes;

  return (
    <section aria-labelledby="notes-panel-title" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="notes-panel-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <NotebookPen aria-hidden="true" className="size-5 text-accent" />
            Reading notes{notes.length > 0 && <span className="text-ink-muted tabular-nums"> ({notes.length})</span>}
          </h2>
          <p className="text-xs text-ink-muted">Private notes &amp; saved word meanings on this device.</p>
        </div>

        <div className="flex items-center gap-1.5">
          {notes.length > 0 && (
            <button
              type="button"
              onClick={exportNotesMarkdown}
              title="Export notes as Markdown (.md)"
              aria-label="Export notes as Markdown"
              className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-line bg-bg px-2.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
            >
              <Download aria-hidden="true" className="size-3.5" />
              Export
            </button>
          )}
          <button
            type="button"
            onClick={() => (isCreating ? setIsCreating(false) : startNewNote())}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {isCreating ? "Close editor" : "New note"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {isCreating && (
        <form onSubmit={handleSave} className="mt-3 space-y-2.5 border-t border-line pt-3">
          <div>
            <label htmlFor="note-title-input" className="sr-only">
              Note title
            </label>
            <input
              id="note-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title…"
              className="min-h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm font-medium text-ink placeholder:text-ink-muted/70 focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="note-body-input" className="sr-only">
              Note content
            </label>
            <textarea
              id="note-body-input"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Jot down key takeaways, quotes, or thoughts…"
              className="w-full rounded-xl border border-line bg-bg p-3 text-sm leading-relaxed text-ink placeholder:text-ink-muted/70 focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setEditingId(null);
              }}
              className="inline-flex min-h-10 items-center rounded-xl border border-line px-3 text-xs font-medium text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex min-h-10 items-center rounded-xl bg-accent px-4 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
            >
              Save note
            </button>
          </div>
        </form>
      )}

      {notes.length > 2 && (
        <div className="mt-3">
          <label htmlFor="notes-filter-input" className="sr-only">
            Filter notes
          </label>
          <input
            id="notes-filter-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your notes…"
            className="min-h-10 w-full rounded-xl border border-line bg-bg px-3 text-xs text-ink placeholder:text-ink-muted/70"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          {notes.length === 0
            ? "No notes yet. Click “New note” here or jot notes inside any open article."
            : "No notes match your search."}
        </p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-0.5">
          {filtered.map((note) => (
            <li key={note.id} className="rounded-xl border border-line bg-bg p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => startEditNote(note)}
                  className="text-left font-serif font-semibold text-ink hover:text-accent"
                >
                  {note.title}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(note.id)}
                  aria-label={`Delete note ${note.title}`}
                  className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-ink-muted hover:text-danger"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-ink-muted">
                {note.content}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
                {formatDate(note.updatedAt) && <span>{formatDate(note.updatedAt)}</span>}
                {note.articleUrl && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a
                      href={note.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                    >
                      <span className="max-w-44 truncate">{note.articleTitle ?? "Source article"}</span>
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Inline collapsible note pad inside ReaderView tied to the currently open article. */
export function ArticleNotesPad({
  articleUrl,
  articleTitle,
  onNotesChanged,
}: {
  articleUrl: string;
  articleTitle: string;
  onNotesChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [existingNote, setExistingNote] = useState<ReaderNote | null>(null);
  const [content, setContent] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let active = true;
    getNotesForArticle(articleUrl)
      .then((list) => {
        if (!active) return;
        const primary = list.find((n) => !n.title.startsWith("Word: ")) ?? null;
        setExistingNote(primary);
        setContent(primary?.content ?? "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [articleUrl]);

  async function handleSaveArticleNote(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    const saved = await saveNote({
      id: existingNote?.id,
      title: `Notes: ${articleTitle}`,
      content,
      articleUrl,
      articleTitle,
      createdAt: existingNote?.createdAt,
    });
    setExistingNote(saved);
    setSavedFlash(true);
    onNotesChanged?.();
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-muted/50 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <NotebookPen aria-hidden="true" className="size-4 text-accent" />
          <span className="text-sm font-semibold text-ink">
            Article notes{existingNote ? " (saved)" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-accent hover:text-accent"
        >
          {open ? "Hide note pad" : existingNote ? "Edit notes" : "Take notes"}
        </button>
      </div>

      {open && (
        <form onSubmit={(e) => void handleSaveArticleNote(e)} className="mt-3 space-y-2">
          <label htmlFor="reader-article-note" className="sr-only">
            Notes for {articleTitle}
          </label>
          <textarea
            id="reader-article-note"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write takeaways, quotes, or summary notes for this article…"
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-muted/70 focus:border-accent"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">Saved locally on this device.</span>
            <button
              type="submit"
              disabled={!content.trim()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50"
            >
              {savedFlash && <Check aria-hidden="true" className="size-3.5" />}
              {savedFlash ? "Saved!" : "Save article note"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
