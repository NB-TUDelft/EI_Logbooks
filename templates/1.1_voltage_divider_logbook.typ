#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 1.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 1.1 " + sym.dot.c + " Voltage divider",
)

#section("PREDICT, SIMULATE, MEASURE", note: "Tasks A1, A2, S1, I1, I2, connected to C1 and C2")
#prompt[Supply is 5 V. Fill the predicted columns as homework, the simulated column after LTspice, and the measured columns at the bench. Leave a cell blank rather than guessing, then say why in the analysis.]
#v(4pt)

#let row(id, r1, r2) = (
  r1, r2,
  line_field(id + "_u_pred"), line_field(id + "_i_pred"),
  line_field(id + "_u_sim"), line_field(id + "_u_meas"), line_field(id + "_i_meas"),
)

#table(
  columns: (auto, auto, 1fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header(
    [*$R_1$*], [*$R_2$*],
    [*$U_"out"$ pred.* \ #text(size: 7pt, weight: "regular")[A1]],
    [*$I$ pred.* \ #text(size: 7pt, weight: "regular")[A2]],
    [*$U_"out"$ sim.* \ #text(size: 7pt, weight: "regular")[S1]],
    [*$U_"out"$ meas.* \ #text(size: 7pt, weight: "regular")[I1]],
    [*$I$ meas.* \ #text(size: 7pt, weight: "regular")[I2]],
  ),
  ..row("p1", [100 #sym.Omega], [100 #sym.Omega]),
  ..row("p2", [1 k#sym.Omega], [1 k#sym.Omega]),
  ..row("p3", [100 k#sym.Omega], [100 k#sym.Omega]),
  ..row("p4", [10 M#sym.Omega], [10 M#sym.Omega]),
  ..row("p5", [1 k#sym.Omega], [220 #sym.Omega]),
)

#v(3pt)
*Combined dividers* #h(6pt) #hint[Tasks A4, S2, I3, I4 and I5, leading to C3]
#v(3pt)
#prompt[I3: record each separate divider output relative to the common ground.]
#grid(
  columns: (auto, 1fr, auto, 1fr), column-gutter: 5pt, align: horizon,
  [$R_3$, $R_4$ output (V):], line_field("i3_r34_meas"),
  [$R_1$, $R_2$ output (V):], line_field("i3_r12_meas"),
)
#v(2pt)
#table(
  columns: (2.2fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Configuration*], [*$U_"out"$ predicted*], [*$U_"out"$ simulated*], [*$U_"out"$ measured*]),
  [Two dividers, outputs connected (I4)], line_field("i4_pred"), line_field("i4_sim"), line_field("i4_meas"),
  [Stacked dividers, left circuit (I5)], line_field("i5_pred"), line_field("i5_sim"), line_field("i5_meas"),
  [Stacked dividers, right circuit (I5)], line_field("i5_right_pred"), line_field("i5_right_sim"), line_field("i5_right_meas"),
)

#pagebreak()
*Setup* #h(6pt) #prompt[Sketch the circuit you built and label the nodes you probed, or name a photo you hand in beside this entry.]
#v(3pt)
#sketchbox("setup", height: 120pt)

*Function generator and loading* #h(6pt) #hint[Tasks A3, A5,A6, I6, I7, C1 to C4]
#v(3pt)
#prompt[C4: sine, 2 V RMS displayed, 1 kHz, zero offset in every row. Enter 1 k#sym.Omega in the blank load cell. Disconnected means one resistor-bank lead is removed; the DMM stays connected. No selector jumper gives 1 M#sym.Omega.]
#v(3pt)
#table(
  columns: (1fr, 1fr, 1fr, 1fr, 1.3fr), align: horizon,
  table.header([*Physical load*], [*Generator load setting*], [*$U_"rms"$ expected (V)*], [*$U_"rms"$ measured (V)*], [*Explanation*]),
  [Disconnected], [HIGH Z], line_field("load_hi_exp"), line_field("load_hi_meas"), line_field("load_hi_note"),
  text_field("load_x_name", width: 78pt, height: 16pt), [HIGH Z],
    line_field("load_x_exp"), line_field("load_x_meas"), line_field("load_x_note"),
  [50 #sym.Omega], [HIGH Z], line_field("load_50_exp"), line_field("load_50_meas"), line_field("load_50_note"),
  [50 #sym.Omega], [50 #sym.Omega], line_field("i7_match_50_exp"), line_field("i7_match_50_meas"), line_field("i7_match_50_note"),
  [Disconnected], [50 #sym.Omega], line_field("i7_open_50_exp"), line_field("i7_open_50_meas"), line_field("i7_open_50_note"),
)

#closing(
  graph_prompt: [Plot measured $U_"out"$ or $I$ against resistance. Label both axes with a unit.],
  graph_height: 100pt,
)
