# Site

Archived. `index.html` and `pdfjs/web/viewer.html` send visitors to the
logbooks in the course book. The rest is the old site, kept for reference.

| Path | What |
|------|------|
| `index.html` | start page: list of logbooks, and the `?logbook=` redirect |
| [`editor/`](editor/) | the add-on to pdf.js that does everything below ([README](editor/README.md)) |
| `pdfjs/` | Mozilla pdf.js 6.4.299 viewer; only `web/viewer.html` is changed, to load the add-on |
| `logbooks/` | built PDFs and `index.json`; made by `tools/build_logbooks.py` (the workflow commits them), do not edit by hand |

## What students get

- Answer boxes that show how much still fits, and mark text that won't fit in yellow.
- Image boxes: insert, replace or remove a picture. JPEG, PNG, GIF, WebP, AVIF,
  BMP, SVG and PDF figures (page 1) work; HEIC only in Safari.
- A Draw tool, for sketches on any page.
- Extra pages at the end: a text page, or an image page with a grid of image
  boxes (1 up to 3 across and 6 down) and a notes box. Both ask which part of
  the logbook they belong to: a section, or a sub-part (`subsection()`).
- Answers keep their box's size; what doesn't fit is marked yellow and moves
  to an extra page on export, unless the student chooses to shrink it.
- A page overview on the left, toggled from the bar.
- Autosave in the browser, per logbook number, and Export PDF to hand in.

## What the export does

- Flattens the form: the answers become ordinary page text.
- Wraps every answer in invisible labels that scripts can read
  (`[[NB2420:field name="..."]] answer [[/NB2420:field]]`), and stores all
  values as JSON in the PDF's Info dictionary. See [`tools/`](../tools/).
- Hashes each inserted photo (SHA-256 and SHA-512 of the original file, before
  it is shrunk), so identical photos can be spotted.

The templates' own printed text is drawn as outlines at build time, so
Turnitin compares only what students wrote.

## Changing the code

See [`editor/README.md`](editor/README.md).
