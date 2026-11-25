import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Toast } from '@glidepath/ui/hud';

/**
 * The one toast of the screen (IA §2): top centre, one line of cause and effect, 2.4 s.
 * `useToast()(message)` shows it; the same message twice shows it twice.
 */
type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [shown, setShown] = useState<{ message: string; id: number } | null>(null);
  const show = useCallback<ShowToast>(
    (message) => setShown((s) => ({ message, id: (s?.id ?? 0) + 1 })),
    [],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext value={value}>
      {children}
      <Toast message={shown?.message} toastId={shown?.id} />
    </ToastContext>
  );
}

/** Shows a toast. Outside a `ToastProvider` it does nothing. */
export function useToast(): ShowToast {
  return useContext(ToastContext) ?? noop;
}

const noop: ShowToast = () => undefined;
