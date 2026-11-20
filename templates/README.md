# Logbook templates

**Don't edit the logbooks here.** They are written in the course book,
[NB-TUDelft/Electronic_Instrumentation](https://github.com/NB-TUDelft/Electronic_Instrumentation),
one file per manual in `book/manuals/weekN/`. Every night, on every push to
`main` and when you press **Run workflow** (Actions → *build and publish*),
[`tools/sync_templates.py`](../tools/sync_templates.py) copies each
`<n.m>_<Title>_logbook.typ` from there into this folder, and the site rebuilds
the PDFs. A logbook removed from the book disappears here too. A change made
here by hand is overwritten by the next copy.

What stays here, because it is the site's own:

| File | |
|------|-|
| `logbook_common.typ` | the shared parts (Name, Preparation, closing, image boxes). Ours, not copied from the book; see below |
| `highlight.txt` | which logbooks are in the Highlight box |
| `BACKUP 0.1_Template_logbook.typ` | the bare logbook, to start a new one from; not on the site |

## Add or change a logbook

1. In the course book, add or edit `book/manuals/weekN/<n.m>_<Title_with_underscores>_logbook.typ`,
   for example `week3/3.2_Active_filters_logbook.typ`. It becomes `?logbook=3.2`.
   A new one can start from a copy of `BACKUP 0.1_Template_logbook.typ` (in the
   book, its import needs `../` in front, as below), like this:

```typst
#import "../logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 3.2",
  subtitle: "NB2420 Electronic Instrumentation · Manual 3.2 · Active filters",
)
// Name, Partner, Date, Group and the Preparation box come automatically.

#section("MEASUREMENTS", note: "Tasks A1, A2")
#prompt[Measure the cut-off frequency.]
#field_row(
  [Predicted $f_c$ [Hz]:], line_field("fc_pred"),
  [Measured $f_c$ [Hz]:],  line_field("fc_meas"),
)

#prompt[Photo of your circuit:]
#image_slot("circuit", height: 160pt)

#closing(graph_prompt: [Plot gain against frequency.])
// Graph box, Reflection and TA check-off come automatically.
```

2. Push it to the book's `main`. The site picks it up the same night, or right
   away if you press **Run workflow** here.
3. Check the result on the site and export it once.

To renumber a logbook, rename it in the book and add an alias here first (next
section), so students keep their work.

## The two logbook_common.typ files

The book has its own `book/manuals/logbook_common.typ`; we keep ours. Ours has
everything the book's has, plus the image boxes (`image_slot`, and
`sketchbox` as an image box) and the bookmarks the editor uses to tag images.
So a template from the book always builds here. If the book's copy ever gets
something ours lacks, the copy step prints a warning and that template fails to
build: add it to ours. To use `image_slot` in the book itself, copy our
`logbook_common.typ` over the book's.

## Students' saved work

The editor keeps each student's work in their browser, keyed by the logbook
**number** (`2.3`), not the file name, so a renamed file keeps its students'
work. A changed file does not change saved work: the save is the student's whole PDF, so they keep the version
they started on until they choose "Start fresh".

To merge one logbook into another, or move saves to a new number, add a line to
[`site/logbook/aliases.json`](../site/logbook/aliases.json):

- `"keys": {"2.3": "2.2"}` moves every 2.3 save to 2.2 the next time a student
  opens a logbook. If they already had a 2.2 save, the newest becomes their save
  and the other stays available under "Use older save".
- `"links": {"2.3": "2.2"}` sends `?logbook=2.3` links to 2.2.

Add the alias before the old file leaves the book. For example, the new 2.2
first arrived here as two "2.3" files; `"2.3": "2.2"` in both lists folded them
into 2.2 without losing anyone's work.

## Highlight

[`highlight.txt`](highlight.txt) decides which logbooks sit in the box at the top
of the start page. One line per change, `YYYY-MM-DD id id ...`; the latest line
whose date has passed wins, so you can plan ahead (now `2.2`).
The site checks every night and switches by itself. `none` or no line: no box.

## Building blocks

| Write | You get |
|-------|---------|
| `line_field("id")` | one-line answer box |
| `area("id", height: 60pt)` | multi-line answer box |
| `check("id")` | checkbox |
| `field_row([Label:], line_field("a"), ...)` | label and box pairs, one per row |
| `image_slot("id", height: 150pt)` | image box: students insert a photo or graph |
| `closing(graph: false)` | closing without the graph box |
| `section("TITLE", note: "...")`, `prompt[...]`, `hint[...]` | headings and instructions |

All of them are defined in [`logbook_common.typ`](logbook_common.typ).

## Tips

- **A picture belongs in an image box.** Anything that is a plot, a photo or a
  sketch: write `image_slot("id")` instead of `area("id")`. The student's
  photo is scaled into the box, so the page layout never shifts. 150 to 200 pt
  high suits a graph.
- **Field ids** are lowercase, unique within the logbook, and are what the
  column names in the submissions table (`tools/`). Keep them the same between
  years if you want to compare years.
- Do not start your own ids with `img_` (reserved for image boxes), and do not
  remove `name`, `partner`, `date`, `group`.
- Size boxes in `pt`, never with a percentage.
- Build locally to check before pushing (needs Python and git):

```
pip install -r tools/requirements.txt
python tools/sync_templates.py
python tools/build_logbooks.py
cd site
python -m http.server 8765
```

  Then open http://127.0.0.1:8765/?logbook=3.2.
