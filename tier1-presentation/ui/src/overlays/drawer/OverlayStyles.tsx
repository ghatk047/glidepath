import { overlayCss } from './styles';

/**
 * Injects the overlay CSS once. React 19 hoists a `<style href precedence>` into the document
 * head and de-duplicates it by `href`, so the drawer and the tooltip can both render this.
 */
export function OverlayStyles() {
  return (
    <style href="glidepath-overlays" precedence="glidepath">
      {overlayCss}
    </style>
  );
}
