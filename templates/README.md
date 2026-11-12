# Logbook templates

One Typst file per logbook. Add, change or delete a file here, push to `main`,
and the site updates itself about a minute later.

## Add a logbook

1. Name the file `<n.m>_<Title_with_underscores>_logbook.typ`, for example
   `3.2_Active_filters_logbook.typ`. It becomes `?logbook=3.2`.
2. Start from this:

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
  reading scripts report (`fc_meas: "1.6 kHz"`). Keep them the same between
  years if you want to compare years.
- Do not start your own ids with `img_` (reserved for image boxes), and do not
  remove `name`, `partner`, `date`, `group` (the plagiarism check uses them).
- Size boxes in `pt`, never with a percentage.
- Build locally to check before pushing (needs Python):

```
pip install -r tools/requirements.txt
python tools/build_logbooks.py
cd site
python -m http.server 8765
```

  Then open http://127.0.0.1:8765/?logbook=3.2.
