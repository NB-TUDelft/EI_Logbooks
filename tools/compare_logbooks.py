"""Plagiarism check across exported NB2420 logbooks.

Usage: python tools/compare_logbooks.py <a.pdf> <b.pdf> [more.pdf ...]
For every pair of files it reports:
  - images with the same SHA-256/SHA-512 (the hash of the photo file as the
    student picked it, taken before the site resized or compressed it)
  - text answers that are identical, or nearly so (ratio >= 0.9)
Name, partner, date and group fields are left out of the text comparison.
Needs: pip install pypdf
"""
import difflib
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_logbook import parse  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SKIP = ('name', 'partner', 'date', 'group')
MIN_LEN = 15          # short answers ("5 V", "yes") match by chance


def norm(s):
    return ' '.join(str(s).lower().split())


def who(d):
    f = {k.lower(): v for k, v in d['fields'].items()}
    pick = lambda key: next((v for k, v in f.items() if key in k and v), '')
    return f"{Path(d['file']).name} ({pick('name') or '?'}; partner {pick('partner') or '?'})"


def compare(a, b):
    hits = []
    ha = {(m or {}).get('sha512') or (m or {}).get('sha256'): s for s, m in a['images'].items() if m}
    for s, m in b['images'].items():
        h = (m or {}).get('sha512') or (m or {}).get('sha256')
        if h and h in ha:
            hits.append(f'  SAME IMAGE  {ha[h]} <-> {s}  ({m.get("file", "")}, sha256 {m.get("sha256", "")[:16]}...)')
    for name in sorted(set(a['fields']) & set(b['fields'])):
        if any(k in name.lower() for k in SKIP):
            continue
        x, y = norm(a['fields'][name]), norm(b['fields'][name])
        if len(x) < MIN_LEN or len(y) < MIN_LEN:
            continue
        r = 1.0 if x == y else difflib.SequenceMatcher(None, x, y).ratio()
        if r >= 0.9:
            hits.append(f'  {"SAME" if r == 1 else f"{r:.0%} "} TEXT   {name}: "{x[:70]}"')
    return hits


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    docs = [parse(p) for p in sys.argv[1:]]
    flagged = 0
    for a, b in itertools.combinations(docs, 2):
        hits = compare(a, b)
        if hits:
            flagged += 1
            print(f'{who(a)}\n  vs {who(b)}')
            print('\n'.join(hits))
    print(f'{flagged} of {len(docs) * (len(docs) - 1) // 2} pairs flagged')
