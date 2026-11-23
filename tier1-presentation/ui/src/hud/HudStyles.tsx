import { hudCss } from './styles';

/**
 * Injects the HUD CSS once. React 19 hoists a `<style href precedence>` into the document head
 * and de-duplicates it by `href`, so every HUD component can render this without a provider.
 */
export function HudStyles() {
  return (
    <style href="glidepath-hud" precedence="glidepath">
      {hudCss}
    </style>
  );
}
