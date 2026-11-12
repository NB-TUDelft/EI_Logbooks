# NB2420 logbooks

Static site: students open a link, fill in their logbook PDF in the browser
(Chrome, Edge or Firefox), add images, and save the PDF with Ctrl+S to hand in.

- `site/index.html`: list of logbooks; `?logbook=2.2` opens one directly.
- `site/pdfjs/`: Mozilla pdf.js 6.4.299 generic viewer. Only `web/viewer.html`
  is changed, to load the add-on.
- `site/logbook/`: the add-on (`logbook.js`, `logbook.css`) and pdf-lib 1.17.1.
  Adds image slots, inserting and deleting added pages, exercise tags and
  autosave with restore.
- `build_logbooks.py <book dir> site`: renders every `*_logbook.typ` into
  `site/logbooks/` plus `index.json`.

Local preview: `python -m http.server 8765` inside `site/`.
