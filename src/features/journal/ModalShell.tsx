import { useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useModalLayer } from "./useModalLayer";

/** Centered dialog on a blurred backdrop: Escape/backdrop-click close it,
 * Tab stays inside, focus is restored on close. */
export function ModalShell({
  label,
  onClose,
  widthClass = "max-w-md",
  children,
}: {
  label: string;
  onClose: () => void;
  widthClass?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalLayer(panelRef, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-journal-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`w-full ${widthClass} max-h-full overflow-y-auto rounded-card border border-border bg-surface shadow-2xl outline-none animate-journal-panel-in`}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell label={title} onClose={onCancel}>
      <div className="p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-text-secondary mt-1.5">{description}</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
