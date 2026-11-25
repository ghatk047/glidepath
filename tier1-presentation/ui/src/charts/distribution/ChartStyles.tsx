import { chartsDistCss } from './styles';

/**
 * Injects the chart CSS once. React 19 hoists a `<style href precedence>` into the document head
 * and de-duplicates it by `href`, so each chart can render this without a provider.
 */
export function ChartStyles() {
  return (
    <style href="glidepath-charts-dist" precedence="glidepath">
      {chartsDistCss}
    </style>
  );
}
