"""Extract the AA seed + golden results into a compact data.json for the UX prototype.
Usage: python3 extract_data.py <model-spec dir> <out data.json>"""
import json, sys, os
spec = sys.argv[1]; out = sys.argv[2]
J = lambda p: json.load(open(os.path.join(spec, p)))
dims = J('seed/aa/dimension_members.json')
vv = J('seed/aa/variable_values.json')
gold = J('reference/golden_results.json')['scenarios']
solv = J('reference/solver_demo_results.json')
scen = J('seed/aa/scenarios.json')
lib = J('seed/aa/lever_library.json')['levers']
vars_ = J('variables.json')['variables']

lines = []
for l in dims['line']:
    if not l['in_scope'] or l['memo']:
        continue
    lines.append([l['id'], l['name'], l['pool'], l['domain'], l.get('vendor') or '', round(vv['line.amount'][l['id']], 3),
                  round(vv['line.capex_share'].get(l['id'], 0), 3), l['addr'], l.get('confidence') or ''])

def r(x, n=3):
    return round(x, n) if isinstance(x, (int, float)) else x
scen_out = {}
for k, g in gold.items():
    scen_out[k] = {kk: r(v) for kk, v in g.items() if not isinstance(v, dict)}
    scen_out[k]['levers'] = {lk: {a: r(b) for a, b in lv.items()} for lk, lv in g['levers'].items()}
    scen_out[k]['vp'] = {vk: {a: r(b) for a, b in vd.items()} for vk, vd in g['vp'].items()}

vmeta = {v['id']: {'label': v['label'], 'unit': v['unit'], 'min': v.get('min'), 'max': v.get('max'), 'step': v.get('step'),
                   'kind': v['kind'], 'control': v['ui']['control'], 'source': v.get('source'), 'conf': v.get('confidence'), 'def': v.get('aa_default')}
         for v in vars_ if v['id'].startswith(('lev.', 'g.', 'hc.', 'org.'))}
presets = {s['id']: {'label': s['label'], 'values': s['values']} for s in scen['scenarios']}
levers = [{'id': l['id'], 'label': l['label'], 'category': l['category'], 'hypothesis': l['hypothesis'],
           'benchmark': l.get('benchmark', '')} for l in lib]
data = {
    'tenant': {'id': 'aa', 'name': 'American Airlines', 'code': 'AA', 'ticker': 'AAL', 'base_year': 'CY26', 'target_year': 'CY27'},
    'pools': dims['pool'], 'domains': [d for d in dims['domain'] if d['id'] != 'out_of_scope_memo'],
    'vps': dims['vp'], 'vendors': dims['vendor'], 'lines': lines,
    'dom_share': vv['org.dom_share'], 'pool_growth': vv['pool.growth'], 'pool_shared': vv['pool.shared'],
    'addr_share': vv['addr.share'], 'scenarios': scen_out, 'presets': presets, 'levers': levers, 'vmeta': vmeta,
    'solver': solv, 'line_total_count': len(dims['line']),
    'tornado': [['g.ot_out_share', 39.1], ['g.ot_in_year', 19.55], ['g.head_start', 16.61], ['lev.L10.ren', 15.61],
                ['lev.L10.shelf', 14.51], ['portfolio.app_cost', 14.36], ['lev.L10.rcut', 14.05], ['hc.ctr', 13.14],
                ['lev.L05.nb', 12.71], ['hc.us', 12.02]],
}
json.dump(data, open(out, 'w'), separators=(',', ':'))
print('lines', len(lines), 'bytes', os.path.getsize(out))
