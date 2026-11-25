import type { BaselineGroupBy, BaselineGroupsView } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { useVariable } from '../../bind';
import { LineAmount } from './LineAmount';
import { GROUP_NOUN, type BaselineMembers } from './model';

type Group = BaselineGroupsView['groups'][number];

/** `line.capex_share[line]` as tier 2 holds it (read-only here, like the prototype). */
function CapexShare({ line }: { line: string }) {
  const v = useVariable('line.capex_share', line);
  return (
    <span data-stale={v.stale || undefined} data-cell="capex">
      {typeof v.value === 'number' ? fmt.pct(v.value, { digits: 0 }) : '—'}
    </span>
  );
}

/**
 * Line table of the selected group: line, vendor, domain, addressability, confidence, capex share
 * and the editable CY26 $M (`line.amount`). Rows follow tier 2's value order. "Edit in Excel"
 * hands over to the Excel module.
 */
export function LineTable({
  by,
  group,
  members,
  onExcel,
}: {
  by: BaselineGroupBy;
  group: Group | undefined;
  members: BaselineMembers;
  onExcel: () => void;
}) {
  const rows = group ? [...group.lines].sort((a, b) => b.value - a.value) : [];
  return (
    <GlassPanel
      level={1}
      header={{
        label: group ? `Line items · ${group.label}` : `Line items · ${GROUP_NOUN[by]}`,
        status: (
          <span className="gp-bl-hint">
            Click any amount to edit
            <button type="button" className="gp-btn" onClick={onExcel}>
              Edit in Excel
            </button>
          </span>
        ),
      }}
      className="gp-bl-lines"
      loading={!group}
    >
      <div className="gp-bl-table-wrap">
        <table className="gp-bl-table">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Vendor</th>
              <th scope="col">Domain</th>
              <th scope="col">Addressability</th>
              <th scope="col">Conf.</th>
              <th scope="col" data-num>
                Capex
              </th>
              <th scope="col" data-num>
                CY26 $M
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const info = members.lines.get(l.key);
              return (
                <tr key={l.key} data-line={l.key}>
                  <th scope="row" title={info?.name ?? l.key}>
                    {info?.name ?? l.key}
                  </th>
                  <td title={info?.vendor}>{info?.vendor}</td>
                  <td title={info ? members.domainLabel(info.domain) : undefined}>
                    {info ? members.domainLabel(info.domain) : ''}
                  </td>
                  <td>
                    {info && (
                      <span className="gp-bl-addr" data-addr={info.addr}>
                        {members.addrLabel(info.addr)}
                      </span>
                    )}
                  </td>
                  <td>{info?.confidence}</td>
                  <td data-num>
                    <CapexShare line={l.key} />
                  </td>
                  <td data-num>
                    <LineAmount line={l.key} name={info?.name} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}
