"""Copy the logbook templates from the course book into templates/.

Usage: python tools/sync_templates.py [path to a checkout of the book]
       python tools/sync_templates.py --check [--compile] <path to a checkout of the book>
Needs: git (only when no path is given)

The course book (NB-TUDelft/Electronic_Instrumentation, book/manuals/weekN/)
is the one place where logbooks are written. This copies every
book/manuals/week*/<n.m>_<Title>_logbook.typ into templates/, points its
import at our own logbook_common.typ, and removes templates/<n.m>_..._logbook.typ
files the book no longer has. logbook_common.typ, highlight.txt, the README and
files whose names don't match the pattern (the BACKUP starter) are ours and
are left alone. The GitHub workflow runs it at the start of every run, at least hourly.

It first checks the book and copies nothing if anything is wrong (a misnamed
logbook, a number in the wrong week folder, two files with one number, an
import the site doesn't have). It then exits with an error, so the workflow
fails and the site keeps its last good version. --check only checks; the
course book's own workflow runs that. With --compile it also compiles every
logbook-looking file with the site's logbook_common.typ (needs
sphinx-typst-render), so an entry with a good name but broken contents fails
in the book too, and every problem is listed at once.

Our logbook_common.typ is not copied: it has the site's extras (image boxes,
bookmarks for the exercises). It warns when the book's copy defines something
ours doesn't, because a template that uses it would then fail to build here.
"""
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parent.parent
TEMPLATES = REPO / 'templates'
BOOK_REPO = os.environ.get('BOOK_REPO', 'https://github.com/NB-TUDelft/Electronic_Instrumentation')
BOOK_BRANCH = os.environ.get('BOOK_BRANCH', 'main')
MANUALS = 'book/manuals'
NAME = re.compile(r'(\d+)\.(\d+)_[^\s/]+_logbook\.typ')
IMPORT = re.compile(r'#import\s+"\.\./logbook_common\.typ"')
FILE_USE = re.compile(r'#(?:import|include)\s+"([^"]+)"|\b(?:image|read|json|csv|yaml|toml)\(\s*"([^"]+)"')
DEFINES = re.compile(r'^#let\s+([A-Za-z_][\w-]*)', re.M)
SITE_COMMON = 'https://raw.githubusercontent.com/NB-TUDelft/EI_Logbooks/main/templates/logbook_common.typ'
HOW = 'name it <n.m>_<Title_with_underscores>_logbook.typ, e.g. 3.2_Active_filters_logbook.typ'


def fetch(dest):
    """Shallow, sparse clone of the book: only book/manuals. Returns its commit."""
    run = lambda *a: subprocess.run(['git', *a], check=True, capture_output=True, text=True).stdout.strip()
    run('clone', '--quiet', '--depth', '1', '--branch', BOOK_BRANCH, '--filter=blob:none',
        '--sparse', BOOK_REPO, str(dest))
    run('-C', str(dest), 'sparse-checkout', 'set', MANUALS)
    return run('-C', str(dest), 'rev-parse', '--short', 'HEAD')


def check(book):
    """The logbooks in the book, {file name: path}, and a list of problems."""
    manuals = book / MANUALS
    found, numbers, problems = {}, {}, []
    candidates = [p for p in manuals.glob('week*/**/*.typ') if 'logbook' in p.name.lower()]
    for src in sorted(candidates):
        rel = src.relative_to(book).as_posix()
        m = NAME.fullmatch(src.name)
        if not m:
            problems.append(f'{rel}: looks like a logbook, but the name is wrong; {HOW}.')
            continue
        if src.parent.parent != manuals:
            problems.append(f'{rel}: put it directly in {MANUALS}/week{m[1]}/, not in a subfolder.')
            continue
        week = re.fullmatch(r'week(\d+)', src.parent.name)
        if not week or int(week[1]) != int(m[1]):
            problems.append(f'{rel}: logbook {m[1]}.{m[2]} belongs in {MANUALS}/week{m[1]}/.')
        number = f'{m[1]}.{m[2]}'
        if number in numbers:
            problems.append(f'{rel} and {numbers[number]} both have number {number}; '
                            'keep one (to merge or renumber, see templates/README.md in EI_Logbooks).')
        numbers[number] = rel
        for use in FILE_USE.finditer(src.read_text(encoding='utf-8')):
            path = use[1] or use[2]
            if path.startswith('@') or path == '../logbook_common.typ':
                continue
            problems.append(f'{rel}: uses "{path}", which the logbook site does not have. '
                            'Only "../logbook_common.typ" can be imported.')
        found[src.name] = src
    if not found and not problems:
        problems.append(f'no logbooks found in {MANUALS}/week*/ of the book.')
    return found, problems


def compile_problems(book):
    """Compile every logbook-looking file in the book the way the site builds
    it (with the site's logbook_common.typ); one problem per file that fails."""
    from sphinx_typst_render._compile import RenderRequest, render, stage_field_library
    ours = TEMPLATES / 'logbook_common.typ'
    if ours.exists():
        common = ours.read_text(encoding='utf-8')
    else:                                   # run from a downloaded copy, e.g. by the book's workflow
        with urllib.request.urlopen(SITE_COMMON, timeout=30) as r:
            common = r.read().decode('utf-8')
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / 'root'
        root.mkdir()
        (root / 'logbook_common.typ').write_text(common, encoding='utf-8')
        stage_field_library(root)
        candidates = [p for p in (book / MANUALS).glob('week*/**/*.typ') if 'logbook' in p.name.lower()]
        for i, src in enumerate(sorted(candidates)):
            rel = src.relative_to(book).as_posix()
            entry = root / f'entry{i}.typ'
            entry.write_text(IMPORT.sub('#import "logbook_common.typ"', src.read_text(encoding='utf-8')), encoding='utf-8')
            try:
                render(RenderRequest(source=entry, root=root, preview='none', fillable=True), Path(tmp) / f'cache{i}')
            except Exception as error:
                first = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
                problems.append(f'{rel}: does not compile: {first}')
    return problems


def sync(book):
    found, problems = check(book)
    if problems:
        fail(problems)

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

    theirs = book / MANUALS / 'logbook_common.typ'
    if theirs.exists():
        ours = set(DEFINES.findall((TEMPLATES / 'logbook_common.typ').read_text(encoding='utf-8')))
        missing = sorted(set(DEFINES.findall(theirs.read_text(encoding='utf-8'))) - ours)
        if missing:
            print('WARNING: the book\'s logbook_common.typ defines', ', '.join(missing),
                  'and templates/logbook_common.typ does not. Templates that use them will not build.')
    return changed


def fail(problems):
    """Print what to fix (also on the run's summary page) and stop."""
    text = ('The logbooks in the course book need a fix before the site can use them. '
            'Nothing was copied; the site keeps its last good version.\n\n'
            + '\n'.join(f'- {p}' for p in problems) + '\n')
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write('### Logbooks: fix needed in the course book\n\n' + text)
    for p in problems:                       # one red annotation per problem
        if os.environ.get('GITHUB_ACTIONS'):
            print(f'::error title=Logbook check::{p}')
    sys.exit(1)


def main():
    args = sys.argv[1:]
    if args[:1] == ['--check']:
        rest = args[1:]
        compile_too = '--compile' in rest
        rest = [a for a in rest if a != '--compile']
        book = Path(rest[0] if rest else '.').resolve()
        found, problems = check(book)
        if compile_too:
            problems += compile_problems(book)
        if problems:
            fail(problems)
        print(f'{len(found)} logbooks, all fine')
        return
    if args:
        book, commit = Path(args[0]).resolve(), 'local copy'
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
