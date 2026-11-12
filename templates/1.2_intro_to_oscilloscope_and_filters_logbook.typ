#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 1.2",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 1.2 " + sym.dot.c + " Oscilloscope and filters",
)

*Coupling* #h(3pt) #hint[Tasks B1, A1 and I1, leading to C1]
#prompt[Square wave, 4 $U_"pp"$, 25 Hz, with a $-2$ V DC offset. Predict each average as homework, then measure it at the bench.]
#v(2pt)

#let dut(id, d) = (
  d, line_field(id + "_avg_pred"), line_field(id + "_avg_meas"),
  line_field(id + "_dc"), line_field(id + "_ac"),
)
#table(
  columns: (auto, 1fr, 1fr, 1.3fr, 1.3fr), align: horizon,
  table.header(
    [*Duty cycle*],
    [*$U_"avg"$ predicted* \ #text(size: 7pt, weight: "regular")[A1]],
    [*$U_"avg"$ measured* \ #text(size: 7pt, weight: "regular")[I1]],
    [*DC coupling shows*], [*AC coupling shows*],
  ),
  ..dut("d50", [50 %]), ..dut("d75", [75 %]), ..dut("d25", [25 %]),
)

#v(3pt)
*Triggering* #h(6pt) #hint[Tasks B2, A2 and I2, leading to C2]
#v(2pt)
#table(
  columns: (1.5fr, 1.5fr, 1.5fr), align: horizon,
  table.header([*Trigger setting*], [*Predicted display*], [*Observed display*]),
  [Level inside the signal range], line_field("tr_in_pred"), line_field("tr_in_obs"),
  [Level above the signal peak], line_field("tr_out_pred"), line_field("tr_out_obs"),
  [Slope changed rising to falling], line_field("tr_slope_pred"), line_field("tr_slope_obs"),
)

*Filter behaviour* #h(6pt) #hint[Task B3,A3,I3, leading to C3: 100 k#sym.Omega with 47 nF]
#v(3pt)
#table(
  columns: (1.4fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([], [*Predicted*], [*Simulated*], [*Measured*]),
  [Behaviour (low or high pass)], line_field("beh_pred"), line_field("beh_sim"), line_field("beh_meas"),
  [$-3$ dB point], line_field("f3_pred"), line_field("f3_sim"), line_field("f3_meas"),
)
#v(3pt)
#prompt[Frequencies you swept, and the amplitude ratio at each:]
#line_field("sweep_notes")

#v(6pt)

#closing(
  graph_prompt: [Plot the measured amplitude ratio against frequency and mark the $-3$ dB point.],
  graph_height: 120pt,
)
