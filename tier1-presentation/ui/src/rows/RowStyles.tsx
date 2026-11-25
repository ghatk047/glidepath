import { rowsCss } from './styles';

/** Injects the rows CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function RowStyles() {
  return (
    <style href="glidepath-rows" precedence="glidepath">
      {rowsCss}
    </style>
  );
}
