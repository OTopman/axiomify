/** Release version embedded into the Studio bundle at build time. */
export const STUDIO_VERSION =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_AXIOMIFY_VERSION) ||
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env?.VITE_AXIOMIFY_VERSION) ||
  '7.1.0';
