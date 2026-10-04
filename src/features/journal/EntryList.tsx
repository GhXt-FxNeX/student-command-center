import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { JournalEntrySummary } from "@/types";
import { entryTimeLabel, formatBytes, formatDuration, formatTotalDuration } from "./journalUtils";
import type { DayGroup } from "./journalUtils";
import { PencilIcon, PlayIcon, TrashIcon } from "./icons";

function EntryRow({
  entry,
  index,
  leaving,
  confirming,
  onOpen,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entry: JournalEntrySummary;
  index: number;
  leaving: boolean;
  confirming: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const time = entryTimeLabel(entry.createdAt);
  const name = entry.title || "Untitled entry";

  return (
    <li
      // Staggered entrance (capped so a long list doesn't crawl in), applied
      // once per mount — rows keep their key across refreshes so they don't
      // re-animate every time something changes.
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms`, animationFillMode: "backwards" }}
      className={`group flex items-center gap-2 rounded-card border border-border bg-surface p-2 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-md motion-reduce:hover:translate-y-0 focus-within:border-accent animate-fade-slide-in ${
        leaving ? "animate-journal-entry-out pointer-events-none" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Play ${name}, ${formatDuration(entry.durationSeconds)}`}
        className="flex flex-1 min-w-0 items-center gap-3 text-left rounded-md"
      >
        <span
          className="relative shrink-0 w-24 aspect-video rounded-md border border-border overflow-hidden flex items-center justify-center text-accent-text"
          style={{ backgroundImage: "linear-gradient(135deg, var(--color-accent-soft), var(--color-bg))" }}
        >
          <PlayIcon className="w-6 h-6 transition-transform duration-150 group-hover:scale-110 motion-reduce:group-hover:scale-100" />
          <span className="absolute bottom-1 right-1 rounded bg-black/70 text-white text-[10px] leading-none px-1 py-0.5 tabular-nums">
            {formatDuration(entry.durationSeconds)}
          </span>
        </span>
        <span className="min-w-0">
          <span className={`block text-sm font-medium truncate ${entry.title ? "" : "text-text-secondary"}`}>{name}</span>
          <span className="block text-xs text-text-secondary mt-0.5">
            {time ? `${time} · ` : ""}
            {formatBytes(entry.fileSizeBytes)}
          </span>
        </span>
      </button>

      {confirming ? (
        <div className="flex items-center gap-1.5 shrink-0 pr-1 animate-fade-slide-in">
          <span className="text-xs text-text-secondary hidden sm:inline">Delete this entry?</span>
          <Button variant="destructive" onClick={onConfirmDelete}>
            Delete
          </Button>
          <Button variant="secondary" onClick={onCancelDelete}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit details for ${name}`}
            title="Edit title & note"
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-text transition-colors"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            aria-label={`Delete ${name}`}
            title="Delete entry"
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </li>
  );
}

/** Entries grouped by day (Today / Yesterday / a full date), each day with
 * its own count and total recorded time. */
export function EntryList({
  groups,
  leavingIds,
  onOpen,
  onEdit,
  onDelete,
}: {
  groups: DayGroup[];
  leavingIds: Set<number>;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  let rowIndex = 0;

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.date} aria-label={group.heading}>
          <div className="flex items-end justify-between gap-3 px-1 mb-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{group.heading}</h3>
              {group.subheading && <p className="text-xs text-text-secondary">{group.subheading}</p>}
            </div>
            <p className="text-xs text-text-secondary tabular-nums shrink-0">
              {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"} ·{" "}
              {formatTotalDuration(group.totalSeconds)}
            </p>
          </div>
          <ul className="space-y-2">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                index={rowIndex++}
                leaving={leavingIds.has(entry.id)}
                confirming={confirmId === entry.id}
                onOpen={() => onOpen(entry.id)}
                onEdit={() => onEdit(entry.id)}
                onAskDelete={() => setConfirmId(entry.id)}
                onCancelDelete={() => setConfirmId(null)}
                onConfirmDelete={() => {
                  setConfirmId(null);
                  onDelete(entry.id);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
