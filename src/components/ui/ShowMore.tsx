import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Incremental rendering for long lists (brief §55: pagination/virtualization).
 *
 * Rendering every row of a list that only ever grows — all tasks ever created,
 * a month of transactions — put ~67,000 DOM nodes on screen at 3,000 tasks
 * (2 s to appear, laggy typing). This shows the first `pageSize` rows and a
 * "Show more" button instead.
 *
 * Do the filtering/searching on the FULL list first and pass the result in, so
 * everything stays findable; `resetKey` (e.g. the active filter + search text)
 * puts the visible count back to one page when the list is replaced by a
 * different one.
 */
export function useIncrementalList<T>(items: readonly T[], resetKey: string, pageSize = 100) {
  const [count, setCount] = useState(pageSize);
  useEffect(() => setCount(pageSize), [resetKey, pageSize]);
  return {
    shown: items.length > count ? items.slice(0, count) : items,
    total: items.length,
    remaining: Math.max(0, items.length - count),
    showMore: () => setCount((c) => c + pageSize),
    pageSize,
  };
}

/** "Showing 100 of 3,000" + a button to reveal the next page. Renders nothing when everything is already shown. */
export function ShowMore({
  shown,
  total,
  remaining,
  onShowMore,
  pageSize,
  noun = "items",
}: {
  shown: number;
  total: number;
  remaining: number;
  onShowMore: () => void;
  pageSize: number;
  noun?: string;
}) {
  if (remaining <= 0) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-3">
      <p className="text-xs text-text-secondary" role="status">
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
      </p>
      <Button variant="secondary" size="sm" onClick={onShowMore}>
        Show {Math.min(pageSize, remaining).toLocaleString()} more
      </Button>
    </div>
  );
}
