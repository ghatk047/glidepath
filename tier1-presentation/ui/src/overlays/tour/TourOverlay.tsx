import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { media } from '../../tokens/media';
import { Coachmark } from './Coachmark';
import { placeCard, type TourPlacement, type TourRect } from './place';
import { Spotlight } from './Spotlight';
import { CARD_GAP_PX, CARD_WIDTH_REM, tourCss } from './styles';

export interface TourOverlayProps {
  /** Target in viewport pixels, or `null` to centre the card with no highlight. */
  rect: TourRect | null;
  index: number;
  count: number;
  title: string;
  body: ReactNode;
  preferred: TourPlacement;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}

const FALLBACK_CARD = { width: CARD_WIDTH_REM * 16, height: 200 };

const viewportSize = () => ({
  width: typeof window === 'undefined' ? 1024 : window.innerWidth,
  height: typeof window === 'undefined' ? 768 : window.innerHeight,
});

const isPhone = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.matchMedia(media.phone).matches === true;
  } catch {
    return false;
  }
};

/**
 * Spotlight and coachmark together: measures the card, places it beside the target (flipping
 * when the preferred side does not fit) and docks it as a bottom sheet at phone width. Mounts
 * the tour CSS itself (React 19 hoists and de-duplicates the `<style href>`).
 */
export function TourOverlay({
  rect,
  index,
  count,
  title,
  body,
  preferred,
  onNext,
  onBack,
  onClose,
}: TourOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK_CARD);
  const [viewport, setViewport] = useState(viewportSize);
  const [phone, setPhone] = useState(isPhone);

  useEffect(() => {
    const onResize = () => {
      setViewport(viewportSize());
      setPhone(isPhone());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // re-measure when the content changes
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
  }, [index, title, body, phone, viewport]);

  const at = placeCard(rect, size, viewport, preferred, CARD_GAP_PX);

  return (
    <>
      <style href="glidepath-tour" precedence="glidepath">
        {tourCss}
      </style>
      <Spotlight rect={rect} />
      <Coachmark
        cardRef={cardRef}
        index={index}
        count={count}
        title={title}
        body={body}
        onNext={onNext}
        onBack={onBack}
        onClose={onClose}
        sheet={phone}
        placement={phone ? 'sheet' : at.placement}
        style={phone ? undefined : { top: at.top, left: at.left }}
      />
    </>
  );
}
