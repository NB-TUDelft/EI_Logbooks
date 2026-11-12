# NB2420 logbooks

Static site: students open a link, fill in their logbook PDF in the browser
(Chrome, Edge or Firefox), add images and pages, and press **Export PDF** to get
the hand-in PDF. Work is autosaved in the browser and offered back on the next
visit; the shield button deletes it.

## Links

All paths are relative, so the site works at a domain root or in a subfolder.
With `<site>` the address where `site/` is published:

| Link | Opens |
|------|-------|
| `<site>/` | list of all logbooks |
| `<site>/?logbook=2.2` | logbook 2.2 directly (any id from `logbooks/index.json`: 1.1, 1.2, 2.1, 2.2, 3.1, 4.1, 4.2, 5.1, 5.2, 6.1) |

Examples: `https://nb2420-logbooks.pages.dev/?logbook=2.2` (Cloudflare),
`https://<group>.pages.gitlab.example/<project>/?logbook=2.2` (GitLab Pages),
`https://<user>.github.io/<repo>/?logbook=2.2` (GitHub Pages),
`http://127.0.0.1:8765/?logbook=2.2` (local).

## Hosting: anywhere that serves static files

Publish the `site/` folder as-is. No server code, no build step on the host.
It must be served over http(s) (not opened as `file://`).

- **GitLab Pages**: `.gitlab-ci.yml` publishes `site/` on the default branch.
- **GitHub Pages**: `.github/workflows/pages.yml` does the same (set Pages
  source to "GitHub Actions" in the repo settings).
- **Cloudflare Pages**: `npx wrangler pages deploy site --project-name <name>`.
  `functions/_middleware.js` is optional and Cloudflare-only: it adds a
  password prompt (secret `SITE_PASSWORD`). Other hosts ignore it.
- **Any web server** (TU web space, nginx, `python -m http.server`): copy `site/`.

Access control (TU login only, password) is the host's job; the site itself
is public to whoever can reach it.

## Reading exported logbooks with code

Export PDF writes a flattened PDF with invisible labels around every answer
(text in render mode 3: not painted, but returned by pypdf, pdfplumber,
PyMuPDF and pdftotext):

```
[[NB2420:page n="3" kind="template"]]
[[NB2420:field name="preparation"]] student text [[/NB2420:field]]
[[NB2420:check name="..." checked="yes"]]
[[NB2420:image slot="graph" filled="yes" exercise="..." file="..."]]
```

Added pages have `kind="text"` (one big field) or `kind="image"`. The Info key
`/LogbookFields` holds the same values verbatim as JSON.
`python tools/parse_logbook.py exported.pdf` prints it all as JSON.

Image labels carry `sha256` and `sha512` of the photo file as the student
picked it, hashed in the browser before resizing and compression, so the same
photo gives the same hash in every logbook. Plagiarism check across a batch:
`python tools/compare_logbooks.py *.pdf` lists pairs with the same image hash
or identical/near-identical answers (name, partner, date, group ignored).

Students can only write into the logbook's fields, draw, insert images into
slots, and add text or image pages at the end; there are no free text boxes,
highlights or stamps to land in random places.

## Updating the logbooks

```
python build_logbooks.py <Electronic_Instrumentation>/book site
```

Renders every `book/manuals/week*/*_logbook.typ` into `site/logbooks/` and
rewrites `index.json`. A new logbook appears on the site automatically if its
file is named `<n.m>_<title>_logbook.typ`. Graph boxes (`closing(graph: true)`)
and `sketchbox(...)` areas become image slots. Needs `sphinx-typst-render`.
Commit the PDFs, then publish.

## Layout

- `site/index.html`: logbook list and `?logbook=` redirect.
- `site/pdfjs/`: Mozilla pdf.js 6.4.299 generic viewer; only `web/viewer.html`
  is changed, to load the add-on.
- `site/logbook/`: the add-on (`logbook.js`, `logbook.css`), pdf-lib 1.17.1,
  fontkit 1.1.1 (export), Inter font.
