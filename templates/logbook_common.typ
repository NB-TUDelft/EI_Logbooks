// Shared scaffolding for the NB2420 log book entries.
//
// Each manual's entry imports this, then supplies only the material that is
// specific to that manual. Keeping the Preparation and closing blocks here
// means every entry asks the same questions in the same order, which is the
// point of a log book. logbook adds Preparation below the identity fields;
// each entry calls closing after its manual-specific tasks.

#import "/_typst_lib/capture_field.typ": capture_field, text_field, textarea_field, checkbox_field

// capture_field's text_field sizes its widget with measure(), which cannot
// resolve a relative width, so a "width: 100%" box yields a 20pt interactive
// area inside a full width outline. fill_cell routes through layout(), which
// sees the real container width. Never size a field with a percentage.
#let line_field(name, height: 16pt) = capture_field(
  field_name: name,
  field_type: "text",
  fill_cell: true,
  min_height: height,
)[
  #box(width: 100%, height: height, stroke: 0.5pt + gray, fill: rgb("#f7f9fb"), inset: 2pt)
]

#let area(name, height: 60pt) = textarea_field(name, height: height)
#let check(name) = checkbox_field(name)

#let prompt(body) = text(size: 8pt, fill: rgb("#555555"), style: "italic", body)
#let hint(body) = text(size: 8pt, fill: rgb("#555555"), body)
#let rule = line(length: 100%, stroke: 0.6pt + rgb("#333333"))

#let band(title, note: "") = block(
  width: 100%, fill: rgb("#e8eef4"), inset: (x: 6pt, y: 4pt), radius: 2pt,
  above: 0pt, below: 0pt,
  [#text(weight: "bold", size: 10.5pt, title) #h(1fr) #text(size: 8pt, note)],
)

// Each section also emits a hidden, bookmarked heading. The PDF outline then
// lists the exercises with their page, which the logbook editor reads to tag
// inserted images with the exercise they belong to.
#let section(title, note: "") = {
  v(6pt)
  place(hide(heading(level: 1, outlined: true, bookmarked: true,
    if note == "" { title } else { title + " (" + note + ")" })))
  band(title, note: note)
  v(4pt)
}

// Reserved image slot for the logbook editor. It is a named text field
// `img_<name>` sized to the box, so the editor can read its position from the
// PDF widget and place a chosen image there. The height is fixed, so the text
// below never reflows when an image is added.
#let image_slot(name, height: 150pt) = capture_field(
  field_name: "img_" + name,
  field_type: "text",
  fill_cell: true,
  min_height: height,
)[
  #box(width: 100%, height: height, stroke: 0.5pt + gray, fill: rgb("#f7f9fb"), inset: 2pt)
]

// A sketch / photo area: an image slot, so students can insert a photo of
// their setup or draw in it with the editor's Draw tool.
#let sketchbox(name, height: 150pt) = block(breakable: false, image_slot(name, height: height))

#let field_row(..pairs) = block(breakable: false, grid(
  columns: (auto, 1fr), column-gutter: 6pt, row-gutter: 5pt, align: horizon,
  ..pairs,
))

// ------------------------------------------------------- standard Preparation
#let preparation(
  theory: [What theories, laws, and/or formulas are most important for this experiment?],
  goals: [What do you expect to learn?],
  prediction: [What do you expect to observe, and why?],
  prep_height: 150pt,
) = block(breakable: false)[
  #section("PREPARATION", note: "complete before the practicum")
  #prompt[
    1. #theory \
    2. #goals \
    3. #prediction
  ]
  #area("preparation", height: prep_height)
]

// ---------------------------------------------------------------- page frame
#let logbook(title: "", subtitle: "", body) = {
  set document(title: title)
  set page(paper: "a4", margin: (x: 14mm, y: 12mm), numbering: "1 / 1")
  set text(font: ("Libertinus Serif", "DejaVu Serif"), size: 9.5pt)
  set par(spacing: 4pt)
  set table(stroke: 0.4pt + rgb("#888888"), inset: 4pt)

  grid(
    columns: (1fr, auto), align: (left + horizon, right + horizon),
    [
      #text(size: 13pt, weight: "bold")[#title] \
      #text(size: 10pt)[#subtitle]
    ],
    hint[Hand in via BrightSpace],
  )
  v(2pt); rule; v(4pt)

  grid(
    columns: (auto, 1fr, auto, 1fr),
    column-gutter: 6pt, row-gutter: 5pt, align: horizon,
    [Name(s):], line_field("name", height: 15pt),
    [Partner:], line_field("partner", height: 15pt),
    [Date:], line_field("date", height: 15pt),
    [Group:], line_field("group", height: 15pt),
  )
  preparation()
  body
}

// ----------------------------------------------------------- standard closing
#let closing(
  analysis: [Which results matched or differed from your expectations, and why?],
  conclusion: [What is the most important thing you learned?],
  do_different: [What would you do differently next time?],
  reflect_height: 125pt,
  graph: true,
  graph_prompt: [Plot your measured data. Label both axes with a unit.],
  graph_height: 150pt,
) = {
  if graph {
    block(breakable: false)[
      #v(6pt)
      *Graph* #h(6pt) #prompt[#graph_prompt]
      #v(3pt)
      #image_slot("graph", height: graph_height)
    ]
  }

  block(breakable: false)[
    #section("REFLECTION", note: "complete before submission")
    #prompt[
      1. #analysis \
      2. #conclusion \
      3. #do_different
    ]
    #area("reflection", height: reflect_height)

    #v(5pt)
    #rule
    #v(3pt)
    #grid(
      columns: (auto, 1fr, auto, 1fr), column-gutter: 6pt, align: horizon,
      [#text(size: 8pt)[TA check-off:]], line_field("ta_sign", height: 14pt),
      [#text(size: 8pt)[Date:]], line_field("ta_date", height: 14pt),
    )
  ]
}
