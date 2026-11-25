import type { ReactNode } from 'react';
import { Segmented, Toggle } from '../inputs/controls';
import { RowStyles } from './RowStyles';

/**
 * ok = changed in the file; new = a line the app does not have; conflict = the app moved since
 * the export; removed = absent from the file. Tier 2 decides which; the row only draws it.
 */
export type DiffStatus = 'ok' | 'new' | 'conflict' | 'removed';
export type DiffChoice = 'file' | 'app';

export interface DiffRowProps {
  /** Stable key of the row as tier 2 sends it; exposed as `data-row-id`. */
  rowId?: string;
  sheet: string;
  /** Item label; also names the controls. */
  item: string;
  /** The three values, formatted by tier 2 / `fmt`. "—" when there is none. */
  exported: ReactNode;
  file: ReactNode;
  appNow: ReactNode;
  status: DiffStatus;
  /** Accept toggle state (ok, new, removed). Default true. */
  accepted?: boolean;
  onAccept?: (accepted: boolean) => void;
  /** Conflict choice. Default 'file'. */
  choice?: DiffChoice;
  onChoice?: (choice: DiffChoice) => void;
}

export const NEW_LINE_LABEL = 'new line';
export const REMOVED_LABEL = 'removed';
export const CONFLICT_LABEL = 'conflict';

const CHOICES = [
  { id: 'file', label: 'File' },
  { id: 'app', label: 'App' },
] as const;

/**
 * Diff row (#25) for the import review: one `<tr>` (place it in `DiffTable`). Presentational:
 * it shows the three values it is handed and reports the take / choice; no rule here decides what
 * is a conflict. Chips carry a word (and an icon where they flag removal), never colour alone.
 */
export function DiffRow({
  rowId,
  sheet,
  item,
  exported,
  file,
  appNow,
  status,
  accepted = true,
  onAccept,
  choice = 'file',
  onChoice,
}: DiffRowProps) {
  return (
    <tr data-status={status} data-row-id={rowId}>
      <td data-col="sheet">{sheet}</td>
      <td data-col="item">{status === 'removed' ? <del>{item}</del> : item}</td>
      <td data-col="exported" data-num>
        {exported}
      </td>
      <td data-col="file" data-num>
        {file}
      </td>
      <td data-col="appNow" data-num>
        {status === 'conflict' && <span className="gp-sr-only">{`${CONFLICT_LABEL}: `}</span>}
        {appNow}
      </td>
      <td data-col="take">
        {status === 'conflict' ? (
          <Segmented<DiffChoice>
            label={`Take for ${item}`}
            size="sm"
            options={CHOICES}
            value={choice}
            onChange={onChoice}
          />
        ) : (
          <span className="gp-diff-take">
            <Toggle
              label={status === 'removed' ? `Accept removal of ${item}` : `Accept ${item}`}
              value={accepted}
              onChange={onAccept}
            />
            {status === 'new' && <span className="gp-diff-chip">{NEW_LINE_LABEL}</span>}
            {status === 'removed' && (
              <span className="gp-diff-chip" data-tone="neg">
                <span aria-hidden="true">✕</span> {REMOVED_LABEL}
              </span>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

export interface DiffTableProps {
  /** `DiffRow`s. */
  children: ReactNode;
  /** Accessible name. */
  label?: string;
}

/** Import-review table: Sheet, Item, Exported, In file, App now, Take. */
export function DiffTable({ children, label = 'Import review' }: DiffTableProps) {
  return (
    <>
      <RowStyles />
      <div className="gp-diff-wrap">
        <table className="gp-diff" aria-label={label}>
          <thead>
            <tr>
              <th scope="col">Sheet</th>
              <th scope="col">Item</th>
              <th scope="col" data-num>
                Exported
              </th>
              <th scope="col" data-num>
                In file
              </th>
              <th scope="col" data-num>
                App now
              </th>
              <th scope="col">Take</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </>
  );
}
