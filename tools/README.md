# Tools

## All submissions in one table

`logbooks_to_dataframe.py` turns a Brightspace "Download all submissions" zip
(or a folder of PDFs) into one table: a pandas DataFrame, and a CSV next to
the input. Needs `pip install pandas pypdf`.

```
python tools/logbooks_to_dataframe.py "LOG session 1.1 Download.zip"
```

```
123 files, 86 students -> LOG session 1.1 Download_logbooks.csv
source
pdf form       72
jpeg           23
no fields      15
site export     2
...
```

Or in Python or a notebook (with `tools/` on the path, or the file copied next
to your notebook):

```python
from logbooks_to_dataframe import load_logbooks
df = load_logbooks("LOG session 1.1 Download.zip")
df[["student", "logbook", "dur_meas", "err_pct"]]
```

One row per handed-in file:

| Column | |
|--------|-|
| `student`, `submitted` | from the Brightspace folder name |
| `file` | file name as handed in |
| `source` | `site export` (from this site: everything), `pdf form` (logbook PDF filled in a PDF reader: the answer boxes), `no fields` (scan, print, flattened elsewhere), or the file type (`jpeg`, `docx`, ...) |
| `logbook`, `exported`, `pages`, `added_pages` | which logbook, export time, page counts |
| one column per answer box | named by the id in the template (`preparation`, `dur_meas`, ...) |
| one column per checkbox | `True` / `False` |
| `img_<box>_file`, `img_<box>_sha256` | for each image box: the photo's file name and its hash (site exports) |

The hash is taken from the original photo file, before the site shrinks it,
so two students who inserted the very same file get the same value.

Answers are read from a JSON copy the site stores inside the PDF, never from
the page text, so nothing a student types (quotes, brackets, text that looks
like a label) can shift or break the table.

## Used by the automatic build

| File | |
|------|-|
| `build_logbooks.py` | builds `site/logbooks/` from `templates/`; the workflow runs it |
| `outline_template.py` | draws the templates' printed text as outlines, so Turnitin compares only the answers |
| `requirements.txt` | what the build installs, including the newest renderer from GitHub |

To build locally: `pip install -r tools/requirements.txt`, then
`python tools/build_logbooks.py`.
