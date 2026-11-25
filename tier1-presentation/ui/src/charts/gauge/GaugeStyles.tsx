import { gaugeCss } from './styles';

/**
 * Injects the gauge and ring CSS once. React 19 hoists a `<style href precedence>` into the
 * document head and de-duplicates it by `href`, so no provider is needed.
 */
export function GaugeStyles() {
  return (
    <style href="glidepath-charts-gauge" precedence="glidepath">
      {gaugeCss}
    </style>
  );
}
