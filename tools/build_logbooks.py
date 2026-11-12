"""Build the logbook PDFs for the site from templates/.

Usage: python tools/build_logbooks.py
Needs: pip install sphinx-typst-render pymupdf

For every templates/<n.m>_<Title>_logbook.typ it writes a fillable PDF to
site/logbooks/, draws the printed text as outlines (tools/outline_template.py),
writes site/logbooks/index.json (the list on the start page) and refreshes
the list of links in README.md. The GitHub workflow runs this on every push
that changes templates/.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

import pymupdf
import typst
from sphinx_typst_render._compile import RenderRequest, render, stage_field_library

sys.path.insert(0, str(Path(__file__).parent))
from outline_template import outline  # noqa: E402

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
    toc = pymupdf.open(stream=typst.compile(str(src), root=str(TEMPLATES), format='pdf')).get_toc()
    doc = pymupdf.open(pdf)
    if toc and not doc.get_toc():
        doc.set_toc(toc)
        doc.saveIncr()
    doc.close()


def update_readme(entries):
    readme = REPO / 'README.md'
    lines = [f'- [{e["id"]} {e["title"]}]({BASE_URL}?logbook={e["id"]})' for e in entries]
    block = '<!-- logbook-links -->\n' + '\n'.join(lines) + '\n<!-- /logbook-links -->'
    text = readme.read_text(encoding='utf-8')
    new = re.sub(r'<!-- logbook-links -->.*?<!-- /logbook-links -->', lambda _: block, text, flags=re.S)
    if new != text:
        readme.write_text(new, encoding='utf-8')


def main():
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
    (OUT / 'index.json').write_text(json.dumps(entries, indent=2) + '\n', encoding='utf-8')
    update_readme(entries)
    print(len(entries), 'logbooks')


if __name__ == '__main__':
    main()
