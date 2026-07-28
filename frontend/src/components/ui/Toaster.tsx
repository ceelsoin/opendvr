import { useToastStore } from "../../store/toastStore";

const variantClasses: Record<string, string> = {
  success: "border-green-700 bg-green-950 text-green-300",
  error: "border-red-700 bg-red-950 text-red-300",
  info: "border-neutral-700 bg-neutral-800 text-neutral-200",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`flex max-w-sm items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm shadow-lg ${variantClasses[toast.variant]}`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
