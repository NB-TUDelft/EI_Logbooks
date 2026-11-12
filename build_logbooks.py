"""Render every NB2420 logbook to a fillable PDF for the site.

Usage: python build_logbooks.py <book dir> <site dir>
Writes <site>/logbooks/<id>.pdf and <site>/logbooks/index.json, where <id> is
the manual number (e.g. "2.2"), so links can be short: ?logbook=2.2
"""
import json, re, shutil, sys
from pathlib import Path
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
from sphinx_typst_render._compile import RenderRequest, render
sys.path.insert(0, str(Path(__file__).parent / 'tools'))
from outline_template import outline

book, site = Path(sys.argv[1]), Path(sys.argv[2])
out = site / 'logbooks'
out.mkdir(parents=True, exist_ok=True)
entries = []
for src in sorted((book / 'manuals').rglob('*_logbook.typ')):
    m = re.match(r'(\d+\.\d+)_(.+)_logbook', src.stem)
    if not m:
        continue
    num, title = m.group(1), m.group(2).replace('_', ' ')
    # The renderer's cache does not track ../logbook_common.typ: always rebuild.
    for stamp in (book / '_typst').glob(f'*/{src.stem}.typst-stamp'):
        stamp.unlink()
    res = render(RenderRequest(source=src, root=book, preview='none', fillable=True), book)
    dest = out / f'{num}_{m.group(2)}_logbook.pdf'
    shutil.copy2(res.pdf, dest)
    outline(dest)        # printed text -> outlines, so it is not counted by Turnitin
    entries.append({'id': num, 'title': title, 'week': src.parent.name, 'file': dest.name})
    print(num, title, '->', dest.name)
(out / 'index.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
print(len(entries), 'logbooks')
