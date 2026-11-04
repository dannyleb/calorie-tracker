import { useEffect } from 'preact/hooks';

export interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  error?: boolean;
}

export function Toast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, toast.error ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [toast?.id]);

  if (!toast) return null;
  return (
    <div class={`toast ${toast.error ? 'toast-error' : ''}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.actionLabel && (
        <button
          class="toast-action"
          onClick={() => {
            toast.onAction?.();
            onDone();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  );
}
