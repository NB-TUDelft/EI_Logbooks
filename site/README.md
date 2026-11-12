# Site

Static files, published as-is to GitHub Pages. No server code.

| Path | What |
|------|------|
| `index.html` | start page: list of logbooks, and the `?logbook=` redirect |
| `logbook/logbook.js`, `logbook.css` | the add-on: image boxes, extra pages, autosave, Export PDF |
| `logbook/pdf-lib.min.js`, `fontkit.umd.min.js`, `fonts/` | pdf-lib 1.17.1, fontkit 1.1.1, Inter (for the export) |
| `pdfjs/` | Mozilla pdf.js 6.4.299 viewer; only `web/viewer.html` is changed, to load the add-on |
| `logbooks/` | built PDFs and `index.json`; made by `tools/build_logbooks.py` (the workflow commits them), do not edit by hand |

## What the export does

- Flattens the form: the answers become ordinary page text.
- Wraps every answer in invisible labels that scripts can read
  (`[[NB2420:field name="..."]] answer [[/NB2420:field]]`), and stores all
  values as JSON in the PDF's Info dictionary. See [`tools/`](../tools/).
- Hashes each inserted photo (SHA-256 and SHA-512 of the original file, before
  it is shrunk), for the plagiarism check.

The templates' own printed text is drawn as outlines at build time, so
Turnitin compares only what students wrote.

## Changing the code

1. Edit `logbook/logbook.js` or `logbook/logbook.css`.
2. **Bump the version** in `pdfjs/web/viewer.html` (`logbook.js?v=...` and
   `logbook.css?v=...`). Browsers cache these files for 10 minutes; a new
   version reaches students straight away.
3. Test locally (see [`templates/`](../templates/) for the commands): fill a
   logbook, insert an image, export, open the PDF, and run
   `python tools/parse_logbook.py` on it. Check both: text the parser reads
   can still be invisible on the page.

For automated tests, `nb2420Logbook.setTestFile('<id of an input type=file>')`
followed by `nb2420Logbook.slotInsert('graph')` inserts an image without a
file dialog, and `nb2420Logbook.state()` returns slots, images and pages.
