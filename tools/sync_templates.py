"""Copy the logbook templates from the course book into templates/.

Usage: python tools/sync_templates.py [path to a checkout of the book]
Needs: git (only when no path is given)

The course book (NB-TUDelft/Electronic_Instrumentation, book/manuals/weekN/)
is the one place where logbooks are written. This copies every
book/manuals/week*/<n.m>_<Title>_logbook.typ into templates/, points its
import at our own logbook_common.typ, and removes templates/<n.m>_..._logbook.typ
files the book no longer has. logbook_common.typ, highlight.txt, the README and
files whose names don't match the pattern (the BACKUP starter) are ours and
are left alone. The GitHub workflow runs it at the start of every run, at least hourly.

Our logbook_common.typ is not copied: it has the site's extras (image boxes,
bookmarks for the exercises). It warns when the book's copy defines something
ours doesn't, because a template that uses it would then fail to build here.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parent.parent
TEMPLATES = REPO / 'templates'
BOOK_REPO = os.environ.get('BOOK_REPO', 'https://github.com/NB-TUDelft/Electronic_Instrumentation')
BOOK_BRANCH = os.environ.get('BOOK_BRANCH', 'main')
MANUALS = 'book/manuals'
NAME = re.compile(r'\d+\.\d+_.+_logbook\.typ')
IMPORT = re.compile(r'#import\s+"(?:\.\./)+logbook_common\.typ"')
DEFINES = re.compile(r'^#let\s+([A-Za-z_][\w-]*)', re.M)


def fetch(dest):
    """Shallow, sparse clone of the book: only book/manuals. Returns its commit."""
    run = lambda *a: subprocess.run(['git', *a], check=True, capture_output=True, text=True).stdout.strip()
    run('clone', '--quiet', '--depth', '1', '--branch', BOOK_BRANCH, '--filter=blob:none',
        '--sparse', BOOK_REPO, str(dest))
    run('-C', str(dest), 'sparse-checkout', 'set', MANUALS)
    return run('-C', str(dest), 'rev-parse', '--short', 'HEAD')


def sync(book):
    manuals = book / MANUALS
    found = {}
    for src in sorted(manuals.glob('week*/*_logbook.typ')):
        if not NAME.fullmatch(src.name):
            print('skipped (name is not <n.m>_<Title>_logbook.typ):', src.relative_to(book))
            continue
        if src.name in found:
            sys.exit(f'two book files are both called {src.name}: '
                     f'{found[src.name].relative_to(book)} and {src.relative_to(book)}')
        found[src.name] = src
    if not found:
        sys.exit(f'no logbooks found in {MANUALS}/week*/ of the book; nothing changed')

    changed = []
    for name, src in found.items():
        text = IMPORT.sub('#import "logbook_common.typ"', src.read_text(encoding='utf-8'))
        dest = TEMPLATES / name
        if not dest.exists() or dest.read_text(encoding='utf-8') != text:
            changed.append(('added' if not dest.exists() else 'updated', name))
            dest.write_text(text, encoding='utf-8', newline='\n')
    for old in sorted(TEMPLATES.glob('*_logbook.typ')):
        if NAME.fullmatch(old.name) and old.name not in found:
            changed.append(('removed', old.name))
            old.unlink()

    theirs = manuals / 'logbook_common.typ'
    if theirs.exists():
        ours = set(DEFINES.findall((TEMPLATES / 'logbook_common.typ').read_text(encoding='utf-8')))
        missing = sorted(set(DEFINES.findall(theirs.read_text(encoding='utf-8'))) - ours)
        if missing:
            print('WARNING: the book\'s logbook_common.typ defines', ', '.join(missing),
                  'and templates/logbook_common.typ does not. Templates that use them will not build.')
    return changed


def main():
    if len(sys.argv) > 1:
        book, commit = Path(sys.argv[1]).resolve(), 'local copy'
        changed = sync(book)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            book = Path(tmp) / 'book'
            commit = fetch(book)
            changed = sync(book)
    for what, name in changed:
        print(f'{what}: {name}')
    print(f'{len(changed) or "no"} template changes from the course book ({commit})')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f'commit={commit}\n')


if __name__ == '__main__':
    main()
