import { useGlassQuality } from './GlassProvider';

/**
 * The sky: ground colour, three aurora blobs (steel, teal, horizon) and fractal grain.
 * Pre-blurred: the blur is baked into the gradients, so the sky uses no `filter` and no
 * `backdrop-filter`. Drifts 46–60 s; still under reduced motion and in the low-blur fallback.
 */
export function Aurora() {
  const quality = useGlassQuality();
  return (
    <div className="gp-aurora" data-quality={quality} aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
