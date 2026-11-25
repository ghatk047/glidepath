import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SolverObjective } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { RadioCard, Toggle } from '@glidepath/ui/inputs/controls';
import { EditPopover, parseNumber } from '@glidepath/ui/inputs/editable';
import { useBindContext, useNode, useVariable } from '../../bind';
import { useBundle } from '../../data';
import {
  CAP_NODE,
  COPY,
  DEFAULT_OBJECTIVE,
  FLOOR_NODE,
  GOAL_NODE,
  OBJECTIVES,
  TARGET_VARIABLE,
} from './copy';
import { SparkIcon, LockIcon } from './icons';
import type { PathChoice } from './params';

/**
 * The goal: the bar tier 2 pushed (`res.bar`). Pressing it edits the net target
 * (`g.target_net`), as on the Cockpit: the popover is fed by the registry definition and its
 * changes preview and commit through the bind layer, so the bar the solver must clear moves.
 */
function GoalValue() {
  const bar = useNode(GOAL_NODE);
  const v = useVariable(TARGET_VARIABLE);
  const d = v.definition;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const text = fmt.money(bar.value);
  const value = v.value;
  const canEdit =
    d !== undefined &&
    d.min !== null &&
    d.max !== null &&
    d.step !== null &&
    typeof value === 'number';
  const fail = () => undefined; // the commit queue (WEB-05) surfaces errors in the shell

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="gp-path-goal-value"
        data-node={GOAL_NODE}
        data-variable-id={TARGET_VARIABLE}
        data-value={typeof bar.value === 'number' ? bar.value : undefined}
        data-changed={v.from === 'scenario' || undefined}
        data-stale={bar.stale || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${COPY.goal} ${text}. ${COPY.editGoal}`}
        disabled={!canEdit}
        onClick={() => setOpen((o) => !o)}
      >
        {text}
      </button>
      {open &&
        canEdit &&
        typeof document !== 'undefined' &&
        createPortal(
          <EditPopover
            label={d.label}
            unit={d.unit}
            min={d.min!}
            max={d.max!}
            step={d.step!}
            source={d.source}
            confidence={d.confidence}
            defaultValue={d.default ?? Number.NaN}
            value={value}
            format={(n) => fmt.money(n)}
            parse={parseNumber}
            anchor={ref.current}
            onChange={(next) => {
              v.preview(next);
              void v.commit(next).catch(fail);
            }}
            onReset={() => void v.commit(null).catch(fail)}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * The value a constraint holds to: the session's cell (`res.fte_us`, `res.tot_ot_it`) until the
 * user types another one. Typed text is read with the editable's `parseNumber` (no clamping:
 * tier 2 validates).
 */
function useHoldValue(node: string) {
  const cell = useNode(node);
  const [text, setText] = useState<string | null>(null);
  const pushed = typeof cell.value === 'number' ? cell.value : null;
  const value = text === null ? pushed : parseNumber(text);
  return { cell, text, setText, value };
}

function HoldRow({ children, toggle }: { children: ReactNode; toggle: ReactNode }) {
  return (
    <li className="gp-path-hold-row">
      <span className="gp-path-hold-label">{children}</span>
      {toggle}
    </li>
  );
}

function HoldInput({
  name,
  node,
  hold,
  format,
}: {
  name: string;
  node: string;
  hold: ReturnType<typeof useHoldValue>;
  format: (v: number | null) => string;
}) {
  const shown = hold.text ?? (hold.cell.value === undefined ? '' : format(hold.cell.value));
  return (
    <input
      type="text"
      inputMode="decimal"
      className="gp-path-hold-input"
      aria-label={name}
      data-node={node}
      data-value={hold.value ?? undefined}
      aria-invalid={hold.value === null || undefined}
      value={shown}
      size={shown.length > 0 ? shown.length : 1}
      onChange={(e) => hold.setText(e.target.value)}
    />
  );
}

/**
 * The GCC hiring capacity to hold to (`gcc_hiring`): tier 2's default from the bundle's `solverDefaults`
 * until the user types another one; `null` when the bundle has none (the row is then not shown).
 */
function useGccHold() {
  const { tenant } = useBindContext();
  const pushed = useBundle(tenant).data?.solverDefaults.gcc_hiring ?? null;
  const [text, setText] = useState<string | null>(null);
  const value = text === null ? pushed : parseNumber(text);
  return { pushed, text, setText, value };
}

/**
 * The Goal panel's choices, lifted so the Result panel's empty state can ask the same question.
 * `choice` is `null` while a switched-on constraint has no readable value.
 */
export function usePathChoice() {
  const [objective, setObjective] = useState<SolverObjective>(DEFAULT_OBJECTIVE);
  const [perVp, setPerVp] = useState(false);
  const [floorOn, setFloorOn] = useState(true);
  // Off by default: the cap needs a value the user chooses (no tier-2 default; see README).
  const [capOn, setCapOn] = useState(false);
  const floor = useHoldValue(FLOOR_NODE);
  const cap = useHoldValue(CAP_NODE);
  // Off by default: a what-if the user adds ("What if the GCC can't hire?").
  const [gccOn, setGccOn] = useState(false);
  const gcc = useGccHold();
  const invalid =
    (floorOn && floor.value === null) ||
    (capOn && cap.value === null) ||
    (gccOn && gcc.value === null);
  const choice: PathChoice | null = invalid
    ? null
    : {
        objective,
        perVp,
        usFloor: floorOn ? floor.value : null,
        oneTimeCap: capOn ? cap.value : null,
        gccHiring: gccOn ? gcc.value : null,
      };
  return {
    objective,
    setObjective,
    perVp,
    setPerVp,
    floorOn,
    setFloorOn,
    capOn,
    setCapOn,
    floor,
    cap,
    gccOn,
    setGccOn,
    gcc,
    choice,
  };
}

export type PathChoiceState = ReturnType<typeof usePathChoice>;

export interface GoalPanelProps {
  state: PathChoiceState;
  /** Target year label (`CY27`) from the tenant row. */
  year: string | null;
  /** "Blend C → D" label from the preset list; `null` hides the action (presets missing). */
  blendLabel: string | null;
  finding: boolean;
  blending: boolean;
  onFind(choice: PathChoice): void;
  onBlend(): void;
}

/**
 * Goal (4 cols): goal `res.bar` (edits `g.target_net`), objective radio cards
 * (`min_risk_mix.objective_options`), "Hold to" constraint toggles and the two actions.
 * The panel only collects choices; `pathSpec` turns them into the contract's solver params.
 */
export function GoalPanel({
  state,
  year,
  blendLabel,
  finding,
  blending,
  onFind,
  onBlend,
}: GoalPanelProps) {
  const {
    objective,
    setObjective,
    perVp,
    setPerVp,
    floorOn,
    setFloorOn,
    capOn,
    setCapOn,
    floor,
    cap,
    gccOn,
    setGccOn,
    gcc,
    choice,
  } = state;
  const find = () => {
    if (choice) onFind(choice);
  };
  const invalid = choice === null;

  return (
    <GlassPanel span={4} className="gp-path-goal" header={{ label: COPY.goal }}>
      <div className="gp-path-goal-row">
        <GoalValue />
        <span className="gp-path-goal-note">{COPY.goalNote(year)}</span>
      </div>

      <h3 className="gp-path-eyebrow">{COPY.optimiseFor}</h3>
      <RadioCard<SolverObjective>
        label={COPY.optimiseFor}
        options={OBJECTIVES.map((o) => ({ id: o.id, label: o.label }))}
        value={objective}
        onChange={setObjective}
      />

      <h3 className="gp-path-eyebrow">{COPY.holdTo}</h3>
      <ul className="gp-path-hold" aria-label={COPY.holdTo}>
        <HoldRow toggle={<Toggle label={COPY.perVp} value={perVp} onChange={setPerVp} />}>
          {COPY.perVp}
        </HoldRow>
        <HoldRow toggle={<Toggle label={COPY.usFloorName} value={floorOn} onChange={setFloorOn} />}>
          {COPY.usFloor}{' '}
          <HoldInput
            name={COPY.usFloorName}
            node={FLOOR_NODE}
            hold={floor}
            format={(v) => fmt.fte(v)}
          />
        </HoldRow>
        <HoldRow toggle={<Toggle label={COPY.oneTimeCapName} value={capOn} onChange={setCapOn} />}>
          {COPY.oneTimeCap}{' '}
          <HoldInput
            name={COPY.oneTimeCapName}
            node={CAP_NODE}
            hold={cap}
            format={(v) => fmt.money(v)}
          />
        </HoldRow>
        {gcc.pushed !== null && (
          <HoldRow
            toggle={<Toggle label={COPY.gccHiringName} value={gccOn} onChange={setGccOn} />}
          >
            {COPY.gccHiring}{' '}
            <input
              type="text"
              inputMode="decimal"
              className="gp-path-hold-input"
              aria-label={COPY.gccHiringName}
              data-value={gcc.value ?? undefined}
              aria-invalid={gcc.value === null || undefined}
              value={gcc.text ?? fmt.fte(gcc.pushed)}
              size={(gcc.text ?? fmt.fte(gcc.pushed)).length || 1}
              onChange={(e) => gcc.setText(e.target.value)}
            />
          </HoldRow>
        )}
        <HoldRow toggle={<Toggle label={`${COPY.stretch}, ${COPY.alwaysOn}`} value disabled />}>
          {COPY.stretch}
        </HoldRow>
        <HoldRow toggle={<Toggle label={`${COPY.estimates}, ${COPY.alwaysOn}`} value disabled />}>
          {COPY.estimates} <LockIcon />
        </HoldRow>
      </ul>

      <div className="gp-path-actions">
        <button
          type="button"
          className="gp-path-btn"
          data-primary=""
          disabled={finding || invalid}
          onClick={find}
        >
          <SparkIcon />
          {finding ? COPY.finding : COPY.find}
        </button>
        {blendLabel !== null && (
          <button type="button" className="gp-path-btn" disabled={blending} onClick={onBlend}>
            {blendLabel}
          </button>
        )}
      </div>
    </GlassPanel>
  );
}
