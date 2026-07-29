interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirm button in red and disables it until the user types `confirmText` exactly, for especially destructive actions (factory reset). */
  danger?: boolean;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Generic confirmation modal - used for the Cameras page's remove/disable
 * actions and the Maintenance page's destructive actions (restart server,
 * factory reset, delete recordings). Follows the same overlay/card pattern
 * as CameraFormDialog/OnvifScanModal (fixed inset-0 backdrop + centered
 * card) for visual consistency.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  isConfirming,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <h2 className="mb-2 text-base font-semibold">{title}</h2>
        <p className="mb-5 text-sm text-neutral-400">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {isConfirming ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
