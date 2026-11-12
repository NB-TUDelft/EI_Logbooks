"""All handed-in logbooks in one table (pandas DataFrame + CSV).

Point it at a Brightspace "Download all submissions" zip, or at a folder:

    python tools/logbooks_to_dataframe.py "LOG session 1.1 Download.zip"
    python tools/logbooks_to_dataframe.py submissions/        # a folder, searched recursively

It writes <zip or folder name>_logbooks.csv next to the input and prints a
summary. From Python or a notebook:

    from logbooks_to_dataframe import load_logbooks
    df = load_logbooks("LOG session 1.1 Download.zip")

One row per handed-in file. Columns:
  student, submitted   from the Brightspace folder name (empty for a plain folder)
  file                 file name as handed in
  source               "site export"  exported from the logbook site (all data)
                       "pdf form"     the PDF filled in a PDF reader (fields only)
                       "no fields"    a PDF without fields (scan, print, other file)
                       "jpeg", "docx" ... not a PDF
  logbook, exported, pages, added_pages
  <field id>           one column per answer box, named as in the template
  <check id>           True/False per checkbox
  img_<slot>_file, img_<slot>_sha256   per image box, for site exports

Answers are read from the JSON copy the site stores in the PDF (Info key
/LogbookFields), never from the page text, so nothing a student types (quotes,
brackets, fake labels) can shift or break the table.
Needs: pip install pandas pypdf
"""
import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import logging

import pandas as pd
from pypdf import PdfReader

logging.getLogger('pypdf').setLevel(logging.ERROR)     # damaged PDFs are common; just read them
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Brightspace folder: "164394-184047 - First Last - 10 November, 2026 1305"
SUBMISSION = re.compile(r'^\d+-\d+ - (?P<student>.+?) - (?P<when>\d{1,2} \w+, \d{4} \d{4})$')
LOGBOOK_ID = re.compile(r'(?<![\d.])(\d+\.\d+)(?![\d.])')


def _brightspace(parts):
    """Student name and submission time from the enclosing folder, if any."""
    for part in reversed(parts):
        m = SUBMISSION.match(part)
        if m:
            when = pd.to_datetime(m['when'], format='%d %B, %Y %H%M', errors='coerce')
            return m['student'], when
    return None, None


def _from_site_export(reader, info):
    data = json.loads(info['/LogbookFields'])
    row = {'source': 'site export',
           'logbook': info.get('/LogbookId'),
           'exported': info.get('/LogbookExported')}
    pages = data.get('pages') or []
    row['pages'] = len(pages) or len(reader.pages)
    row['added_pages'] = sum(1 for p in pages if p.get('kind') != 'template')
    row.update(data.get('fields', {}))
    row.update({k: v is not None for k, v in data.get('checks', {}).items()})
    for slot, m in (data.get('images') or {}).items():
        col = 'img_' + slot.replace('page:', 'page_')
        row[col + '_file'] = (m or {}).get('original_filename')
        row[col + '_sha256'] = (m or {}).get('sha256')
    return row


def _from_pdf_form(reader):
    fields = reader.get_fields() or {}
    row = {'pages': len(reader.pages)}
    for name, f in fields.items():
        if name.startswith('img_'):
            continue
        v = f.get('/V')
        if f.get('/FT') == '/Btn':
            row[name] = v not in (None, '/Off', 'Off')
        else:
            row[name] = '' if v is None else str(v)
    filled = any(v not in ('', False) for k, v in row.items() if k != 'pages')
    row['source'] = 'pdf form' if fields and filled else 'no fields'
    return row


def _read_pdf(data, name):
    try:
        reader = PdfReader(io.BytesIO(data))
        info = reader.metadata or {}
        if '/LogbookFields' in info:
            row = _from_site_export(reader, info)
        else:
            row = _from_pdf_form(reader)
    except Exception as e:  # damaged or encrypted file
        return {'source': f'unreadable ({type(e).__name__})'}
    # "2.2" from the export's id, else from the PDF title or the file name
    m = next((m for s in (row.get('logbook'), info.get('/Title'), name)
              if s and (m := LOGBOOK_ID.search(str(s)))), None)
    row['logbook'] = m[1] if m else None
    return row


def _files(path):
    """(path parts, file name, bytes) for every file in a zip or folder."""
    path = Path(path)
    if path.is_file() and path.suffix.lower() == '.zip':
        with zipfile.ZipFile(path) as z:
            for i in z.infolist():
                if not i.is_dir():
                    parts = i.filename.split('/')
                    yield parts[:-1], parts[-1], lambda i=i, z=z: z.read(i)
    elif path.is_dir():
        for f in sorted(path.rglob('*')):
            if f.is_file():
                yield f.relative_to(path).parts[:-1], f.name, f.read_bytes
    else:
        raise FileNotFoundError(f'{path} is not a zip or a folder')


def load_logbooks(path='.'):
    """DataFrame with one row per handed-in file in a zip or folder."""
    rows = []
    for parts, name, read in _files(path):
        if name.lower() in ('index.html', 'desktop.ini') or name.endswith('_logbooks.csv'):
            continue
        student, when = _brightspace(parts)
        row = {'student': student, 'submitted': when, 'file': name}
        if name.lower().endswith('.pdf'):
            row.update(_read_pdf(read(), name))
        else:
            row['source'] = name.rsplit('.', 1)[-1].lower() if '.' in name else 'file'
        rows.append(row)
    meta = ['student', 'submitted', 'file', 'source', 'logbook', 'exported', 'pages', 'added_pages']
    df = pd.DataFrame(rows)
    df = df[[c for c in meta if c in df.columns] + [c for c in df.columns if c not in meta]]
    for c in ('pages', 'added_pages'):
        if c in df.columns:
            df[c] = df[c].astype('Int64')
    return df.sort_values(['student', 'file'], na_position='last').reset_index(drop=True)


def save_csv(df, out):
    """CSV with the csv module (pandas' to_csv trips over some broken
    installs). utf-8-sig so Excel shows accented names correctly."""
    with open(out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(df.columns)
        for row in df.itertuples(index=False):
            w.writerow(['' if pd.isna(v) else v for v in row])


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    df = load_logbooks(src)
    out = src.parent / f'{src.stem}_logbooks.csv' if src.is_file() else src / f'{src.name}_logbooks.csv'
    save_csv(df, out)
    print(f'{len(df)} files, {df["student"].nunique()} students -> {out}')
    print(df['source'].value_counts().to_string())


if __name__ == '__main__':
    main()
