#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 4.2",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 4.2 " + sym.dot.c + " Real opamps",
)

#section("BIAS AND OFFSET", note: "Tasks A1, A2, S1, I1, C1")
#prompt[Your own chip, not the typical one. The class spread column is the point: it tells you whether your number is normal.]
#v(4pt)

#table(
  columns: (auto, 1fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header(
    [*Quantity*], [*Datasheet typ*], [*Datasheet max*], [*Simulated*],
    [*Measured (your chip)*], [*Class spread*],
  ),
  [$V_"offset"$], line_field("vo_typ"), line_field("vo_max"), line_field("vo_sim"), line_field("vo_meas"), line_field("vo_class"),
  [$I_"bias"$], line_field("ib_typ"), line_field("ib_max"), line_field("ib_sim"), line_field("ib_meas"), line_field("ib_class"),
)
#v(3pt)
#prompt[Which $R_a$ did you choose to isolate each, and why that value?]
#line_field("ra_choice")

#v(6pt)
#section("BANDWIDTH AND SLEW RATE", note: "Tasks A3, A4, S2, I2, I3, C2")
#prompt[Fill one row per amplifier you designed. If GBW is really constant, the last column should not move.]
#v(3pt)
#let amp(i) = (
  line_field("a" + str(i) + "_gain"), line_field("a" + str(i) + "_bw_pred"),
  line_field("a" + str(i) + "_bw_sim"), line_field("a" + str(i) + "_bw_meas"),
  line_field("a" + str(i) + "_gbw"),
)
#table(
  columns: (1fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Closed-loop gain*], [*Predicted BW*], [*Simulated BW*], [*Measured BW*], [*Gain $times$ BW*]),
  ..amp(1), ..amp(2), ..amp(3),
)
#v(3pt)
#field_row(
  [Slew rate measured:], line_field("slew"),
  [Slew-limited frequency, predicted and measured:], line_field("slew_f"),
  [Output current limit found (Task I3):], line_field("iout"),
)

#pagebreak()
#section("GOLDEN RULES, TIGHTENED", note: "Tasks I4, I5, C3")
#prompt[Rewrite each ideal rule from 4.1 as an inequality, using the number you actually measured.]
#v(4pt)

#table(
  columns: (1.2fr, 1.4fr), align: horizon,
  table.header([*Golden rule (4.1)*], [*Tightened version (4.2)*]),
  [$U_+ = U_-$], line_field("g1"),
  [$I_(i n +) = I_(i n -) = 0$], line_field("g2"),
  [The output is an ideal voltage source], line_field("g3"),
  [Open-loop gain $arrow infinity$], line_field("g4"),
  [No rate limit on the output], line_field("g5"),
)

#v(6pt)
*Integrator* #h(6pt) #hint[Tasks A6, S3, I4, I5]
#v(3pt)
#field_row(
  [Drift rate before taming:], line_field("int_drift"),
  [What you added to tame it:], line_field("int_fix"),
  [Slope before and after scaling:], line_field("int_slope"),
)

#closing(
  graph: false,
)
