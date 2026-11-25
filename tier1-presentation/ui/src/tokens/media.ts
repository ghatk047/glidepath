import { breakpoints } from './tokens.generated';

/** Media-query helpers built from the token breakpoints (tablet 1180, phone 760). */
export const media = {
  tablet: `(max-width: ${breakpoints.tablet}px)`,
  phone: `(max-width: ${breakpoints.phone}px)`,
} as const;

export const mediaQuery = {
  tablet: `@media ${media.tablet}`,
  phone: `@media ${media.phone}`,
} as const;

export const matches = (
  q: keyof typeof media,
  mm: (query: string) => { matches: boolean } = (s) =>
    (globalThis as unknown as { matchMedia(q: string): { matches: boolean } }).matchMedia(s),
): boolean => mm(media[q]).matches;
