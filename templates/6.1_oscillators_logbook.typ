#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 6.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 6.1 " + sym.dot.c + " Relaxation oscillator",
)

#section("COMPARATOR AND INTEGRATOR", note: "Tasks B1, B2, A1, A2")
#prompt[Assume $U_H = +10 V$ and $U_L = -10 V$ for your first predictions. You measure the actual output limits later.]
#v(4pt)

*Integrator slopes* #h(6pt) #hint[Task B2, with $R_c = 47"k"Omega$ and $C = 100"nF"$]
#v(3pt)
#field_row(
  [Slope for an input of $+2 V$:], line_field("b2_slope_pos"),
  [Slope for an input of $-2 V$:], line_field("b2_slope_neg"),
)

#v(6pt)
*Switching thresholds* #h(6pt) #hint[Task A2, with $R_a = 10"k"Omega$ and $R_b = 33"k"Omega$]
#v(3pt)
#field_row(
  [Upper threshold $U_("T,up")$:], line_field("a2_ut_up"),
  [Lower threshold $U_("T,down")$:], line_field("a2_ut_down"),
  [Measured output limits $U_H$ and $U_L$:], line_field("a2_limits_meas"),
)

#v(6pt)
*Why hysteresis?* #h(6pt) #prompt[In one or two sentences: what does the second threshold buy you when the input is noisy and slow?]
#area("b1_hysteresis", height: 46pt)

#v(6pt)
#pagebreak()
#section("ONE OSCILLATION CYCLE", note: "Tasks B3, A3, S1, S2")

*Predicted cycle* #h(6pt) #hint[Task A3]
#v(3pt)
#field_row(
  [Slope of $U_("tri")$ while $U_q = U_H$:], line_field("a3_slope_high"),
  [Slope of $U_("tri")$ while $U_q = U_L$:], line_field("a3_slope_low"),
  [Duration of one ramp:], line_field("a3_ramp_time"),
  [Period $T$ and frequency $f$:], line_field("a3_period_freq"),
  [Simulated period and frequency:], line_field("s2_period_freq"),
)

#v(6pt)
*What changes the cycle?* #h(6pt) #hint[Task A3 step 4]
#v(3pt)
#let ch(id, c) = (c, line_field(id + "_slope"), line_field(id + "_tri"), line_field(id + "_period"))
#table(
  columns: (1.2fr, 1fr, 1.2fr, 1fr), align: horizon,
  table.header([*Change*], [*Ramp slope*], [*Triangle peak-to-peak*], [*Period $T$*]),
  ..ch("a3_rc2", [Double $R_c$]),
  ..ch("a3_rahalf", [Halve $R_a$]),
)

#section("CONCLUSIONS", note: "Tasks B3 and A3")

#v(6pt)
*The loop in your own words* #h(6pt) #prompt[Start from a positive comparator output and follow one full cycle. Name the threshold that ends each ramp, and say where the energy comes from.]
#area("b3_cycle", height: 60pt)

#closing(
  graph_prompt: [Sketch $U_q$ and $U_("tri")$ against time for one complete cycle. Mark both switching thresholds and the period $T$.],
  graph_height: 130pt,
)
