import type { ReactNode } from 'react';
import { tipProps } from '../overlays/drawer';
import { RowStyles } from './RowStyles';

export interface TraceNodeProps {
  /** Spec node id, verbatim (`res.net`). Becomes `data-node`, which the trace drawer treats as its trigger. */
  nodeId: string;
  label: ReactNode;
  /** Node value, formatted by the caller with `fmt`. */
  value: ReactNode;
  /** Small note under the value ("665m shares"). */
  note?: ReactNode;
  /** Accent ring and glow: this is the node the trace drawer shows. */
  selected?: boolean;
  /** The node was pressed: open the trace drawer on `nodeId`. */
  onOpen?: (nodeId: string) => void;
  className?: string;
}

/** Trace node (#23): one link of the savings-to-share-price chain. A button that opens the trace drawer. */
export function TraceNode({ nodeId, label, value, note, selected, onOpen, className }: TraceNodeProps) {
  return (
    <>
      <RowStyles />
      <button
        type="button"
        className={className ? `gp-tnode ${className}` : 'gp-tnode'}
        data-node={nodeId}
        data-selected={selected || undefined}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen?.(nodeId)}
        {...tipProps(nodeId)}
      >
        <span className="gp-tnode-label">{label}</span>
        <span className="gp-tnode-value">{value}</span>
        {note !== undefined && note !== null && <span className="gp-tnode-note">{note}</span>}
      </button>
    </>
  );
}

/** One node of a chain: `TraceNode` props without the selection and handler, which the chain owns. */
export type TraceChainNode = Pick<TraceNodeProps, 'nodeId' | 'label' | 'value' | 'note'>;

export interface TraceChainProps {
  nodes: readonly TraceChainNode[];
  /** Node id whose trace drawer is open. */
  selectedId?: string | null;
  onOpen?: (nodeId: string) => void;
  /** Accessible name of the list. */
  label?: string;
}

function Arrow() {
  return (
    <span className="gp-trace-link" aria-hidden="true" data-testid="trace-arrow">
      <svg viewBox="0 0 24 24">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/** The trace chain (`.trace`): nodes in order, an arrow between each pair; scrolls sideways when narrow. */
export function TraceChain({ nodes, selectedId, onOpen, label = 'Trace chain' }: TraceChainProps) {
  return (
    <>
      <RowStyles />
      <ol className="gp-trace" aria-label={label}>
        {nodes.map((n, i) => (
          <li className="gp-trace-item" key={n.nodeId}>
            {i > 0 && <Arrow />}
            <TraceNode {...n} selected={n.nodeId === selectedId} onOpen={onOpen} />
          </li>
        ))}
      </ol>
    </>
  );
}
