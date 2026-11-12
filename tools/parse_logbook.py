"""Read the answers out of an exported NB2420 logbook PDF.

Usage: python tools/parse_logbook.py <exported.pdf> [more.pdf ...]
Prints one JSON object per file:
  {"file", "logbook", "exported", "pages": [...], "fields": {name: text},
   "checks": {name: bool}, "images": {slot: {...} | null}}

The export (Export PDF on the site) wraps every answer in invisible text
labels, so any text extractor sees them:
  [[NB2420:page n="3" kind="template"]]
  [[NB2420:field name="preparation"]] ...student text... [[/NB2420:field]]
  [[NB2420:check name="ok_1" checked="yes"]]
  [[NB2420:image slot="graph" filled="yes" exercise="..." file="..."]]
The labels give where each answer is; the Info key /LogbookFields holds the
same values verbatim (characters the page font lacks are '?' in the labels).
Needs: pip install pypdf
"""
import json
import re
import sys

from pypdf import PdfReader

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ATTR = re.compile(r'(\w+)="([^"]*)"')
TAG = re.compile(r'\[\[NB2420:(page|field|check|image)((?:\s+\w+="[^"]*")*)\]\]')
FIELD = re.compile(r'\[\[NB2420:field name="([^"]*)"\]\](.*?)\[\[/NB2420:field\]\]', re.S)


def parse(path):
    reader = PdfReader(path)
    meta = reader.metadata or {}
    out = {'file': str(path), 'logbook': meta.get('/LogbookId'), 'exported': meta.get('/LogbookExported'),
           'pages': [], 'fields': {}, 'checks': {}, 'images': {}}
    for page in reader.pages:
        text = page.extract_text() or ''
        for kind, attrs in TAG.findall(text):
            a = dict(ATTR.findall(attrs))
            if kind == 'page':
                out['pages'].append(a)
            elif kind == 'check':
                out['checks'][a.get('name')] = a.get('checked') == 'yes'
            elif kind == 'image':
                out['images'][a.get('slot')] = a if a.get('filled') == 'yes' else None
        for name, value in FIELD.findall(text):
            out['fields'][name] = re.sub(r'\s*\n\s*', ' ', value).strip()  # wrapped lines joined
    exact = meta.get('/LogbookFields')
    if exact:                     # verbatim values (line breaks, Ω, µ) win over the page text
        exact = json.loads(exact)
        out['fields'].update(exact.get('fields', {}))
        for slot, m in exact.get('images', {}).items():
            out['images'][slot] = m
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        print(json.dumps(parse(p), ensure_ascii=False, indent=2))
