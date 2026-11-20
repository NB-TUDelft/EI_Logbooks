# Logbook templates

**Don't edit logbooks here.** Write them in the
[course book](https://github.com/NB-TUDelft/Electronic_Instrumentation), as
`book/manuals/weekN/<n.m>_<Title>_logbook.typ` (that becomes `?logbook=n.m`).
[`sync_templates.py`](../tools/sync_templates.py) copies them here each time
the workflow runs ([when](../README.md#how-it-publishes)). Hand edits here are
overwritten (and the run fails, to say so); a logbook removed from the book
disappears here too. If a logbook in the book has a problem, nothing is copied
and the run fails with what to fix. The book's own guide to writing entries is
its AGENTS.md, section 12, and its "log book entries" workflow runs the same
check on every pull request.

Ours, not copied:

- `logbook_common.typ`: the shared parts. It has all of the book's, plus image
  boxes and exercise bookmarks. If the book's copy gets something ours lacks,
  the copy step warns: add it here.
- `highlight.txt`: the Highlight box (below).
- `BACKUP 0.1_Template_logbook.typ`: the bare logbook, to start from.

## Add a logbook

In the book, copy the BACKUP file to `weekN/`, rename it, and add the
logbook's own parts. Push to the book's `main`, then check it on the site and
export once.

```typst
#import "../logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 3.2",
  subtitle: "NB2420 Electronic Instrumentation · Manual 3.2 · Active filters",
)
// Name, Partner, Date, Group and Preparation come automatically.

#section("MEASUREMENTS", note: "Tasks A1, A2")
#prompt[Measure the cut-off frequency.]
#field_row(
  [Predicted $f_c$ [Hz]:], line_field("fc_pred"),
  [Measured $f_c$ [Hz]:],  line_field("fc_meas"),
)
#image_slot("circuit", height: 160pt)

#closing(graph_prompt: [Plot gain against frequency.])
// Graph box, Reflection and TA check-off come automatically.
```

## Students' saved work

Saves are kept in the student's browser, keyed by logbook **number**, so a
renamed file keeps its work. A save is the student's whole PDF: they keep the
version they started on until "Start fresh".

To renumber or merge a logbook, first add it to
[`site/logbook/aliases.json`](../site/logbook/aliases.json):

- `"keys": {"2.3": "2.2"}`: 2.3 saves move to 2.2. If both exist, the newest
  wins and the other stays under "Use older save".
- `"links": {"2.3": "2.2"}`: `?logbook=2.3` opens 2.2.

## Highlight

[`highlight.txt`](highlight.txt) lists the logbooks in the box at the top of
the start page, e.g. `3.1` or `1.1 1.2`. Change it by hand when needed; the site
updates when you push. `none`: no box.

## Building blocks

| Write | You get |
|-------|---------|
| `line_field("id")` | one-line answer box |
| `area("id", height: 60pt)` | multi-line answer box |
| `check("id")` | checkbox |
| `field_row([Label:], line_field("a"), ...)` | label and box pairs |
| `sketchbox("id", height: 150pt)` | image box for a photo, graph or sketch (see below) |
| `closing(graph_prompt: [...], graph_height: 120pt)` | closing with a graph box; `graph: false` leaves it out |
| `section("TITLE", note: "...")`, `prompt[...]`, `hint[...]` | headings and instructions |

## Images

Any plot, photo, screenshot or sketch gets an image box, never an `area`.
Students insert a picture or draw in it on the site; the layout never shifts.

- In the book, write `sketchbox("id", height: 150pt)`. The book's own
  `logbook_common.typ` draws it as a blank area with a "Photo or file
  reference" line; ours turns it into an image box. (`image_slot` only exists
  in ours, so the book build would fail on it.)
- Put a `prompt[...]` above it saying what goes in, with axes and units.
- Place it in the `section` of its task. The site tags each image with the
  last section that starts on or before its page.
- 150 to 200 pt high suits a graph. For one graph at the end, use the
  closing graph box instead.

## Tips

- Field ids are lowercase and unique; they become the columns in the
  submissions table. Keep them between years to compare years.
- Don't start ids with `img_`, and keep `name`, `partner`, `date`, `group`.
- Size boxes in `pt`, never in percent.
- To build locally: see [`tools/`](../tools/README.md#used-by-the-automatic-build).
