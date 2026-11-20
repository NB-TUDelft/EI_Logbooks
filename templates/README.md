# Logbook templates

One Typst file per logbook. Add, change or delete a file here, push to `main`,
and the site updates itself about a minute later.

## Add a logbook

1. Name the file `<n.m>_<Title_with_underscores>_logbook.typ`, for example
   `3.2_Active_filters_logbook.typ`. It becomes `?logbook=3.2`.
2. Start from a copy of `BACKUP 0.1_Template_logbook.typ` (the bare logbook; the
   name does not match the pattern, so it is not on the site), and add the
   logbook's own parts, like this:

```typst
#import "logbook_common.typ": *

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

3. Push. Check the result on the site and export it once.

## Students' saved work

The editor keeps each student's work in their browser, keyed by the logbook
**number** (`2.3`), not the file name. So you can rename a file, or have two files
with the same number, and students keep their work. A changed file does not
change saved work: the save is the student's whole PDF, so they keep the version
they started on until they choose "Start fresh".

To merge one logbook into another, or move saves to a new number, add a line to
[`site/logbook/aliases.json`](../site/logbook/aliases.json):

- `"keys": {"2.3": "2.2"}` moves every 2.3 save to 2.2 the next time a student
  opens a logbook. If they already had a 2.2 save, the newest becomes their save
  and the other stays available under "Use older save".
- `"links": {"2.3": "2.2"}` sends `?logbook=2.3` links to 2.2.

Add the alias before you delete the old file.

## Highlight

[`highlight.txt`](highlight.txt) decides which logbooks sit in the box at the top
of the start page. One line per change, `YYYY-MM-DD id id ...`; the latest line
whose date has passed wins, so you can plan ahead (now `2.1 2.2` from 16 Nov).
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
- Build locally to check before pushing (needs Python):

```
pip install -r tools/requirements.txt
python tools/build_logbooks.py
cd site
python -m http.server 8765
```

  Then open http://127.0.0.1:8765/?logbook=3.2.
