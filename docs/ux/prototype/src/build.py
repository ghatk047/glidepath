"""Assemble the Glidepath UX prototype.
python3 build.py <src dir> <out dir>
Writes <out>/glidepath.html (standalone, open in any browser) and <out>/artifact/index.html (fragment for publishing)."""
import sys, os
src, out = sys.argv[1], sys.argv[2]
rd = lambda f: open(os.path.join(src, f), encoding='utf-8').read()
css = rd('styles.css') + '\n[hidden]{display:none!important}\n'
js = '\n'.join(rd(f) for f in ['core.js', 'views.js', 'docs.js', 'app.js'])
frag = rd('shell.html').replace('/*CSS*/', css).replace('/*DATA*/', rd('data.json')).replace('/*JS*/', js)
os.makedirs(os.path.join(out, 'artifact'), exist_ok=True)
open(os.path.join(out, 'artifact', 'index.html'), 'w', encoding='utf-8').write(frag)
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + frag + '\n</body>\n</html>\n')
open(os.path.join(out, 'glidepath.html'), 'w', encoding='utf-8').write(full)
print('ok', len(full))
