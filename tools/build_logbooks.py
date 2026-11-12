"""Build the logbook PDFs for the site from templates/.

Usage: python tools/build_logbooks.py [--links-only]
Needs: pip install sphinx-typst-render pymupdf

For every templates/<n.m>_<Title>_logbook.typ it writes a fillable PDF to
site/logbooks/, draws the printed text as outlines (tools/outline_template.py),
writes site/logbooks/index.json (the list on the start page, with the ids in
templates/highlight.txt marked) and refreshes
the site address and links in README.md. The GitHub workflow runs it on every
push that changes templates/, and with --links-only (README only, no
packages needed) on every push.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parent.parent
TEMPLATES = REPO / 'templates'
OUT = REPO / 'site' / 'logbooks'
BASE_URL = os.environ.get('SITE_URL', 'https://nb-tudelft.github.io/EI_Logbooks/')
NAME = re.compile(r'(\d+)\.(\d+)_(.+)_logbook')


def copy_bookmarks(src, pdf):
    """The fillable step drops Typst's bookmarks; the site reads them to tag
    each image with its exercise, so put them back."""
    import pymupdf
    import typst
    toc = pymupdf.open(stream=typst.compile(str(src), root=str(TEMPLATES), format='pdf')).get_toc()
    doc = pymupdf.open(pdf)
    if toc and not doc.get_toc():
        doc.set_toc(toc)
        doc.saveIncr()
    doc.close()


def highlighted():
    """Ids listed in templates/highlight.txt (one per line, # starts a comment)."""
    f = TEMPLATES / 'highlight.txt'
    ids = [l.split('#')[0].strip() for l in f.read_text(encoding='utf-8').splitlines()] if f.exists() else []
    return [i for i in ids if i]


def write_index(entries):
    """site/logbooks/index.json, with "highlight": true on the highlighted ids."""
    hl = highlighted()
    for e in entries:
        e.pop('highlight', None)
        if e['id'] in hl:
            e['highlight'] = True
    (OUT / 'index.json').write_text(json.dumps(entries, indent=2) + '\n', encoding='utf-8')


def update_readme(entries):
    """Rewrite the site address and the link list in README.md, between the
    <!-- site-url --> and <!-- logbook-links --> markers. Needs no packages."""
    readme = REPO / 'README.md'
    lines = [f'- [{e["id"]} {e["title"]}]({BASE_URL}?logbook={e["id"]})' for e in entries]
    hl = ', '.join(f'{e["id"]} {e["title"]}' for e in entries if e.get('highlight')) or 'nothing'
    site = (f'**Site:** {BASE_URL}\n\n**Highlighted on the start page:** {hl} '
            f'(change it in [`templates/highlight.txt`](templates/highlight.txt))')
    blocks = {'site-url': site, 'logbook-links': '\n'.join(lines)}
    text = new = readme.read_text(encoding='utf-8')
    for name, body in blocks.items():
        new = re.sub(rf'<!-- {name} -->.*?<!-- /{name} -->',
                     lambda _, n=name, b=body: f'<!-- {n} -->\n{b}\n<!-- /{n} -->', new, flags=re.S)
    if new != text:
        readme.write_text(new, encoding='utf-8')
        print('README links updated')


def main():
    from sphinx_typst_render._compile import RenderRequest, render, stage_field_library
    sys.path.insert(0, str(Path(__file__).parent))
    from outline_template import outline
    OUT.mkdir(parents=True, exist_ok=True)
    stage_field_library(TEMPLATES)          # templates/_typst_lib/capture_field.typ
    entries, written = [], set()
    with tempfile.TemporaryDirectory() as cache:      # fresh: the renderer's cache misses logbook_common.typ
        for src in sorted(TEMPLATES.glob('*_logbook.typ')):
            m = NAME.fullmatch(src.stem)
            if not m:
                print('skipped (name is not <n.m>_<Title>_logbook.typ):', src.name)
                continue
            lid, title = f'{m[1]}.{m[2]}', m[3].replace('_', ' ')
            res = render(RenderRequest(source=src, root=TEMPLATES, preview='none', fillable=True), Path(cache))
            dest = OUT / f'{src.stem}.pdf'
            shutil.copyfile(res.pdf, dest)
            copy_bookmarks(src, dest)
            outline(dest)
            written.add(dest.name)
            entries.append({'id': lid, 'title': title, 'week': f'week{m[1]}', 'file': dest.name})
            print(lid, title)
    for old in OUT.glob('*.pdf'):           # a template that was removed or renamed
        if old.name not in written:
            old.unlink()
    write_index(entries)
    update_readme(entries)
    print(len(entries), 'logbooks')


if __name__ == '__main__':
    if '--links-only' in sys.argv:          # highlight flags and README only, from the existing index.json
        entries = json.loads((OUT / 'index.json').read_text(encoding='utf-8'))
        write_index(entries)
        update_readme(entries)
    else:
        main()
