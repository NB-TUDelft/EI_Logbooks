# Tools

```
pip install -r tools/requirements.txt     # includes the newest renderer from GitHub
```

| Script | Does |
|--------|------|
| `build_logbooks.py` | builds `site/logbooks/` from `templates/` (the workflow runs it) |
| `parse_logbook.py <pdf>...` | reads a handed-in PDF: one JSON per file |
| `compare_logbooks.py <pdf> <pdf>...` | plagiarism check across a batch |
| `outline_template.py <pdf>...` | draws a PDF's text as outlines (used by the build) |

## Reading handed-in PDFs

```
python tools/parse_logbook.py Logbook_2.2_Ada_Lovelace.pdf
```

```json
{
  "logbook": "2.2_Timed_acquisitions_logbook",
  "exported": "2026-11-12T19:34:48.691Z",
  "pages": [{"n": "1", "kind": "template"}, {"n": "2", "kind": "template"}],
  "fields": {"name": "Ada Lovelace", "partner": "Charles Babbage", "dur_meas": "5.21", "...": "..."},
  "checks": {"f_led": true},
  "images": {"graph": {"page": 2, "original_filename": "plot.png", "sha256": "dfd5...", "sha512": "a948..."}}
}
```

Field names are the ids in the template, so collecting one value from every
student is a short loop. Added pages show up as `"kind": "text"` or
`"kind": "image"`.

## Plagiarism check

```
python tools/compare_logbooks.py submissions/*.pdf
```

```
Logbook_2.2_Ada_Lovelace.pdf (Ada Lovelace; partner Charles Babbage)
  vs Logbook_2.2_Charles_Babbage.pdf (Charles Babbage; partner Ada Lovelace)
  SAME IMAGE  graph <-> graph  (plot.png, sha256 dfd535334b5c7360...)
  SAME TEXT   preparation: "theory: ohm's law and the voltage divider ..."
1 of 1 pairs flagged
```

It reports, for every pair of PDFs, images from the very same file and answers
that are identical or at least 90% similar. Name, partner, date and group, and
answers under 15 characters, are skipped. The image hash only matches an exact
copy of the file: a cropped or re-saved photo is not caught. Lab partners
share data, so a flag is a reason to look, not a verdict.
