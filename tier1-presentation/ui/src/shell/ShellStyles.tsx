import { createContext, useContext, type ReactNode } from 'react';
import { shellCss } from './styles';

const Injected = createContext(false);

/** Injects the shell CSS once: a component renders it only when no ancestor shell component did. */
export function ShellStyles({ children }: { children?: ReactNode }) {
  const already = useContext(Injected);
  if (already) return <>{children}</>;
  return (
    <Injected.Provider value>
      <style data-glidepath-shell="">{shellCss}</style>
      {children}
    </Injected.Provider>
  );
}
