import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (variant: ToastVariant, message: string) => void;
  removeToast: (id: string) => void;
}

// Not using crypto.randomUUID() here: it requires a secure context (https
// or localhost), but this app is commonly accessed over plain http on a LAN
// IP (e.g. http://192.168.x.x:4000/web/), where that API is unavailable.
let nextId = 0;
function generateToastId(): string {
  nextId += 1;
  return `${Date.now()}-${nextId}`;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (variant, message) => {
    const id = generateToastId();
    set((state) => ({ toasts: [...state.toasts, { id, variant, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
