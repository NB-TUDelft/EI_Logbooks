#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 4.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 4.1 " + sym.dot.c + " Opamp basics",
)

#section("THREE CONFIGURATIONS", note: "Tasks A1, A3, A5, I1, I4, I5, C1")
#prompt[The side-by-side view is the point. Each column tells you when to reach for that topology.]
#v(4pt)

#let prop(id, label) = (label, line_field(id + "_ni"), line_field(id + "_inv"), line_field(id + "_ti"))
#table(
  columns: (1.1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Property*], [*Non-inverting*], [*Inverting*], [*Transimpedance*]),
  ..prop("gain", [Gain formula]),
  ..prop("invar", [Input variable (V or I)]),
  ..prop("zin", [Input impedance]),
  ..prop("zout", [Output impedance]),
  ..prop("phase", [Phase $U_"out"$ vs $U_"in"$]),
  ..prop("use", [Typical use case]),
)

#v(6pt)
*Predicted, simulated, measured gain* #h(6pt) #hint[Task C2]
#v(3pt)
#let gn(id, c) = (c, line_field(id + "_pred"), line_field(id + "_sim"), line_field(id + "_meas"), line_field(id + "_disc"))
#table(
  columns: (1.5fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Circuit*], [*Predicted $G$*], [*Simulated $G$*], [*Measured $G$*], [*Discrepancy*]),
  ..gn("na", [Non-inverting, $R_a slash R_b = 3.3"k" slash 1"k"$]),
  ..gn("nb", [Non-inverting, $R_a slash R_b = 1"k" slash 3.3"k"$]),
  ..gn("iv", [Inverting, $R_f slash R_i = 1"k" slash 220$]),
)

#v(6pt)
*Buffer and transimpedance* #h(6pt) #hint[Tasks I3 and I5]
#v(3pt)
#field_row(
  [Source voltage without the buffer:], line_field("buf_without"),
  [Source voltage with the buffer:], line_field("buf_with"),
  [Photodiode $U_"out"$, LED off and on:], line_field("pd_out"),
  [$R_f$ used, and the current it implies:], line_field("pd_rf"),
)

#v(6pt)
#pagebreak()
*Saturation* #h(6pt) #hint[Tasks S1 and S3]
#v(3pt)
#field_row(
  [Input amplitude where the output first clipped:], line_field("clip_in"),
  [Clipping levels seen, positive and negative:], line_field("clip_levels"),
  [$I_"in"$ where the transimpedance stage saturated:], line_field("ti_sat"),
)

#section("CONCLUSIONS", note: "Tasks C3 and C4")

#v(6pt)
*C3 When do you reach for a buffer?* #h(6pt) #prompt[Use your Task I3 numbers. A gain of 1 sounds useless, so say what it actually buys you.]
#area("c3", height: 54pt)

#v(4pt)
*C4 A one-line design rule for saturation* #h(6pt) #prompt[Given a supply and a desired output swing, what is the largest input you may apply?]
#area("c4", height: 46pt)

#closing(
  graph_prompt: [Plot $U_"out"$ against $U_"in"$ for one amplifier, or $U_"out"$ against LED drive for the photodiode, and mark where it stops being a straight line.],
  graph_height: 122pt,
)
