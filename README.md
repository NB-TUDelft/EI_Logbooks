# NB2420 logbooks

Students fill in their NB2420 logbook in the browser, add a graph or photo,
and press **Export PDF** to get the PDF they hand in on Brightspace.

**Live:** https://nb-tudelft.github.io/EI_Logbooks/ (list of logbooks), or one
logbook directly: `https://nb-tudelft.github.io/EI_Logbooks/?logbook=2.2`.

Everything runs in the student's browser: typing, inserting images, hashing
and the export. Nothing is uploaded anywhere. Work is autosaved in that
browser only and offered back on the next visit; the shield button deletes it.
Works in Chrome, Edge and Firefox.

## Contents

1. [What students can do](#what-students-can-do)
2. [Reading handed-in PDFs with code](#reading-handed-in-pdfs-with-code)
3. [Plagiarism check](#plagiarism-check)
4. [Writing or changing a logbook (for next year)](#writing-or-changing-a-logbook-for-next-year)
5. [Publishing](#publishing)
6. [Changing the site code](#changing-the-site-code)
7. [Layout of this repository](#layout-of-this-repository)

## What students can do

- Type into the fields of the logbook.
- **Insert image** in a graph or sketch box. The photo is scaled to fit the
  box, so the layout never shifts. **Replace** swaps it.
- **Image page** / **Text page** add a full page at the end (a photo, or one
  big text box). Added pages can be deleted; the logbook's own pages cannot.
- **Draw** for quick sketches on the page.
- **Export PDF** downloads the flattened PDF to hand in.

There are no free text boxes, highlights or stamps, so every answer lands in
a known place.

## Reading handed-in PDFs with code

The exported PDF is flattened (no form fields left), but every answer is
wrapped in invisible text labels. They are not painted, so the PDF looks
normal, but any text extractor (pypdf, pdfplumber, PyMuPDF, pdftotext)
returns them:

```
[[NB2420:page n="1" kind="template"]]
[[NB2420:field name="preparation"]] student text [[/NB2420:field]]
[[NB2420:check name="ok_1" checked="yes"]]
[[NB2420:image slot="graph" filled="yes" file="plot.png" sha256="dfd5..." sha512="a948..."]]
```

Added pages are `kind="text"` or `kind="image"`. The PDF's Info dictionary
also holds every value verbatim as JSON (`/LogbookFields`), including line
breaks and characters such as Ω and µ that the label font may lack.

`tools/parse_logbook.py` reads all of it (needs `pip install pypdf`):

```
python tools/parse_logbook.py Logbook_2.2_Ada_Lovelace.pdf
```

Output (shortened):

```json
{
  "file": "Logbook_2.2_Ada_Lovelace.pdf",
  "logbook": "2.2_Timed_acquisitions_logbook",
  "exported": "2026-11-12T19:34:48.691Z",
  "pages": [{"n": "1", "kind": "template"}, {"n": "2", "kind": "template"}],
  "fields": {
    "name": "Ada Lovelace",
    "partner": "Charles Babbage",
    "dur_meas": "5.21",
    "preparation": "Theory: Ohm's law and the voltage divider ...",
    "ta_sign": ""
  },
  "checks": {},
  "images": {
    "graph": {
      "kind": "slot", "slot": "graph", "page": 2,
      "exercise": "SWEEP AND CONCLUSIONS (Tasks A4, I3, C3)",
      "original_filename": "shared_graph.png",
      "original_width": 1600, "original_height": 1200,
      "sha256": "dfd53533...", "sha512": "a948d672...",
      "inserted": "2026-11-12T19:31:45.792Z"
    }
  }
}
```

Field names are the ones in the logbook's `.typ` file, so a script can, for
example, collect `dur_meas` from every student into one table.

## Plagiarism check

When a student inserts a photo, the browser takes the SHA-256 and SHA-512 of
the original file, before it shrinks and compresses it for the PDF. The same
photo therefore gives the same hash in every logbook. A cropped, re-saved or
screenshotted photo gets a different hash, so this only catches exact copies
of the file.

```
python tools/compare_logbooks.py submissions/*.pdf
```

For every pair of PDFs it reports images with the same hash, and answers that
are identical or at least 90% similar. Name, partner, date and group are
skipped, and so are answers shorter than 15 characters (`5 V`, `yes`).
Example:

```
Logbook_2.2_Ada_Lovelace.pdf (Ada Lovelace; partner Charles Babbage)
  vs Logbook_2.2_Charles_Babbage.pdf (Charles Babbage; partner Ada Lovelace)
  SAME IMAGE  graph <-> graph  (shared_graph.png, sha256 dfd535334b5c7360...)
  SAME TEXT   preparation: "theory: ohm's law and the voltage divider ..."
  SAME TEXT   reflection: "the average interval matched the prediction ..."
1 of 1 pairs flagged
```

Lab partners are expected to share data and graphs, so a flag is a reason to
look, not a verdict.

## Writing or changing a logbook (for next year)

The logbooks are Typst files in the course book repository,
[NB-TUDelft/Electronic_Instrumentation](https://github.com/NB-TUDelft/Electronic_Instrumentation):

```
book/manuals/logbook_common.typ                        shared building blocks
book/manuals/week2/2.2_Timed_acquisitions_logbook.typ  one logbook
```

A file named `<n.m>_<Title_with_underscores>_logbook.typ` anywhere under
`book/manuals/` becomes logbook `n.m` on the site.

### Minimal logbook

```typst
#import "../logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 3.1",
  subtitle: "NB2420 Electronic Instrumentation · Manual 3.1 · Filters",
)
// logbook adds Name, Partner, Date, Group and the Preparation box.

#section("MEASUREMENTS", note: "Tasks A1, A2")
#prompt[Measure the cut-off frequency.]
#field_row(
  [Predicted $f_c$ [Hz]:], line_field("fc_pred"),
  [Measured $f_c$ [Hz]:],  line_field("fc_meas"),
)

#prompt[Photo or sketch of your circuit:]
#sketchbox("circuit", height: 160pt)     // an image box

#closing(graph_prompt: [Plot gain against frequency.])
// closing adds the Graph image box, Reflection and TA check-off.
```

### Building blocks (`logbook_common.typ`)

| Write | You get |
|-------|---------|
| `line_field("id")` | one-line answer box |
| `area("id", height: 60pt)` | multi-line answer box |
| `check("id")` | checkbox |
| `field_row([Label:], line_field("a"), [Label:], line_field("b"))` | label and box pairs, one per row |
| `image_slot("id", height: 150pt)` | **image box**: students insert a photo or graph here |
| `sketchbox("id", height: 150pt)` | the same image box, kept on one page |
| `closing(graph: true, graph_prompt: [...])` | graph image box, reflection, TA check-off; `graph: false` drops the graph |
| `section("TITLE", note: "...")`, `prompt[...]`, `hint[...]` | headings and instruction text |

### Turning a box into an image box

Anything that is a picture (a plot, a photo of the setup, a hand sketch)
should be an image box, not a text box. Replace

```typst
#area("setup_photo", height: 150pt)
```

with

```typst
#image_slot("setup_photo", height: 150pt)
```

`image_slot` writes a PDF field named `img_<id>`; the site finds image boxes
by that prefix and places the photo inside, scaled to fit. Pick a height that
suits the picture (150 to 200 pt for a graph). In the exported PDF the image's
label reads `slot="setup_photo"`.

### Rules for field names

- Unique within one logbook, lowercase, no spaces: `dur_meas`, `fc_pred`.
- Do not start your own field names with `img_`: that prefix marks image boxes.
- Keep `name`, `partner`, `date` and `group`: the plagiarism check uses them
  to label students and leaves them out of the comparison.
- Keep the same names from year to year if you want to compare across years.
- Size boxes in `pt`, never with a percentage height (see the comment in
  `logbook_common.typ`).

### Rendering the PDFs

```
python build_logbooks.py <path to Electronic_Instrumentation>/book site
```

This renders every `*_logbook.typ` into `site/logbooks/` and rewrites
`site/logbooks/index.json` (the list on the start page). It needs the
`sphinx-typst-render` package from the course book. Open each new PDF on the
local site (below), try every field and image box, export once, then commit
`site/logbooks/` and push.

## Publishing

Pushing to `main` publishes `site/` to GitHub Pages
(`.github/workflows/pages.yml`, about 30 seconds). If a deploy fails with "No
artifacts named github-pages", that is a GitHub hiccup: re-run the workflow.
Only the person who pushed gets an email about a failed run.

`site/` is plain static files with relative paths, so it also works on other
hosts: GitLab Pages (`.gitlab-ci.yml`), Cloudflare Pages
(`npx wrangler pages deploy site --project-name <name>`, where
`functions/_middleware.js` adds an optional password from the secret
`SITE_PASSWORD`), or any web server. It must be served over http(s), not
opened as `file://`.

Local test server:

```
cd site
python -m http.server 8765
```

Then open http://127.0.0.1:8765/?logbook=2.2.

## Changing the site code

The add-on is `site/logbook/logbook.js` and `logbook.css`. After changing
either, **bump the version** in `site/pdfjs/web/viewer.html`:

```html
<script src="../../logbook/logbook.js?v=2026-11-12c"></script>
```

Browsers cache these files for 10 minutes; a new `?v=` makes students get the
change straight away.

Before pushing a change to the export, export a filled logbook and look at it
in a real PDF viewer, and run `tools/parse_logbook.py` on it. Text that the
parser reads can still be invisible on the page, and a page that looks right
can still have labels the parser misses. Both happened once (2026-11-12).

Automated tests can feed an image without a file dialog:
`nb2420Logbook.setTestFile('<id of an input type=file>')`, then
`nb2420Logbook.slotInsert('graph')`. `nb2420Logbook.state()` returns the
current slots, images and pages.

## Layout of this repository

- `site/index.html`: logbook list and the `?logbook=` redirect.
- `site/logbooks/`: the rendered logbook PDFs and `index.json`.
- `site/logbook/`: the add-on (`logbook.js`, `logbook.css`), pdf-lib 1.17.1,
  fontkit 1.1.1 (for export), Inter font.
- `site/pdfjs/`: Mozilla pdf.js 6.4.299 viewer, unchanged except
  `web/viewer.html`, which loads the add-on.
- `tools/parse_logbook.py`, `tools/compare_logbooks.py`: reading and comparing
  exported PDFs.
- `build_logbooks.py`: renders the Typst logbooks into `site/logbooks/`.
