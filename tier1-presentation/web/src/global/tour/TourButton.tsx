import { Icon, TOOL_ICONS } from '../shell/modules';
import { tourStore, useTour } from './store';

const css = [
  '.gp-tour-btn { position: relative; }',
  '.gp-tour-btn[data-tour-seen] .gp-tour-dot { display: none; }',
  '.gp-tour-dot { position: absolute; top: 0.25rem; right: 0.25rem; width: 0.4rem; height: 0.4rem; border-radius: var(--radius-pill); background: var(--accent); box-shadow: none; }',
  '@media (max-width: 40rem) { .gp-tour-btn > span:not(.gp-tour-dot) { display: none; } }',
].join('\n');

/** Top-bar entry (WIZ-10 mounts it before "Find any number"). Always starts at step 1. */
export function TourButton() {
  const seen = useTour((s) => s.seen);
  return (
    <>
      <style href="glidepath-tour-button" precedence="glidepath">
        {css}
      </style>
      <button
        type="button"
        className="gp-search gp-tour-btn"
        aria-label="Start the walkthrough"
        data-tour-button=""
        data-tour-seen={seen ? '' : undefined}
        onClick={() => tourStore.getState().start()}
      >
        <Icon paths={TOOL_ICONS.tour} />
        <span>Tour</span>
        <span className="gp-tour-dot" aria-hidden="true" />
      </button>
    </>
  );
}
