import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import { TourOverlay } from '@glidepath/ui/overlays/tour';
import type { ModuleId } from '../../app/modules';
import { useTenants } from '../../data';
import { useShellNavigation } from '../shell/navigation';
import { TourBody } from './body';
import { tourStore, useTour } from './store';
import { TOUR_STEPS } from './steps';
import { useAnchor } from './useAnchor';

/** Tenant on screen: the URL's slug (`/:tenant/...`) when a router is mounted. */
function useTenantSlug(): string | undefined {
  const router = useRouter({ warn: false }) as
    | { state: { matches: { params: unknown }[] } }
    | undefined;
  const params = (router?.state.matches.at(-1)?.params ?? {}) as Record<string, string>;
  return params['tenant'];
}

/**
 * Mount once inside `BindProvider` (WIZ-10). While open it takes the viewer to the step's screen
 * (`toModule` only: never a commit, preview or scenario switch), waits for the anchor, then
 * shows the spotlight and card. A missing anchor centres the card and sets `data-tour-missing`.
 * Closes when the tenant changes.
 */
export function TourHost({ module }: { module: ModuleId }) {
  const open = useTour((s) => s.open);
  const index = useTour((s) => s.index);
  const nav = useShellNavigation();
  const tenants = useTenants();
  const slug = useTenantSlug();

  const step = TOUR_STEPS[index]!;
  const onScreen = step.module === null || step.module === module;

  // navigate once per step: the effect re-runs only when the target screen or step changes
  const navigated = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      navigated.current = null;
      return;
    }
    if (!onScreen && step.module && navigated.current !== step.id) {
      navigated.current = step.id;
      nav.toModule(step.module);
    }
  }, [open, onScreen, step, nav]);

  // tenant change ends the tour
  const firstSlug = useRef(slug);
  useEffect(() => {
    if (firstSlug.current !== slug) {
      firstSlug.current = slug;
      tourStore.getState().close('skip');
    }
  }, [slug]);

  const { rect, missing } = useAnchor(step.anchor, open && onScreen);

  if (!open) return null;
  // while moving screens (or waiting for the anchor) nothing is drawn, so the old screen is not dimmed
  if (!onScreen) return null;
  if (step.anchor && !rect && !missing) return null;

  const list = tenants.data?.tenants ?? [];
  const tenantName = (list.find((t) => t.slug === slug) ?? list[0])?.name ?? '';
  const { next, back, close } = tourStore.getState();

  return (
    <div
      data-tour
      data-tour-step={step.id}
      data-tour-missing={missing ? '' : undefined}
    >
      <TourOverlay
        rect={missing ? null : rect}
        index={index}
        count={TOUR_STEPS.length}
        title={step.title}
        body={<TourBody text={step.body} tenantName={tenantName} />}
        preferred={step.placement}
        onNext={next}
        onBack={back}
        onClose={() => close('skip')}
      />
    </div>
  );
}
