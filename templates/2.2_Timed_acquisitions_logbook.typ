#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 2.2",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 2.2 " + sym.dot.c + " Timed acquisitions",
)

#section("TIMING ACCURACY", note: "Tasks A1, I1, C1")
#prompt[A 5 s measurement at a 50 ms target interval. Predict as homework, then fill the measured column from your own timing data.]
#v(4pt)

#table(
  columns: (2fr, 1fr, 1fr, auto), align: horizon,
  table.header([*Parameter*], [*Predicted*], [*Measured*], [*Unit*]),
  [Total measurement duration], line_field("dur_pred"), line_field("dur_meas"), [s],
  [Sampling interval (target)], line_field("int_pred"), line_field("int_meas"), [ms],
  [Minimum measured interval], line_field("min_pred"), line_field("min_meas"), [ms],
  [Maximum measured interval], line_field("max_pred"), line_field("max_meas"), [ms],
  [Average measured interval], line_field("avg_pred"), line_field("avg_meas"), [ms],
  [Jitter (max $-$ min)], line_field("jit_pred"), line_field("jit_meas"), [ms],
)
#v(3pt)
#field_row(
  [Timing function used (`ticks_ms` or `ticks_us`), and why:], line_field("ticks_choice"),
  [Maximum timing error as a % of the 50 ms target:], line_field("err_pct"),
)

#v(6pt)
#section("SAMPLING RATE LIMITS", note: "Tasks A2, I2, I3, C2")
#let sr(id, sig, f) = (
  sig, f, line_field(id + "_req"), line_field(id + "_ach"), line_field(id + "_ok"),
)
#table(
  columns: (1.4fr, 0.7fr, 1.2fr, 1.2fr, 0.9fr), align: horizon,
  table.header(
    [*Signal type*], [*Test $f$ [Hz]*],
    [*Minimum required rate [Hz]*], [*Achieved rate [Hz]*], [*Sufficient?*],
  ),
  ..sr("s_pot", [Potentiometer (slow)], [< 1]),
  ..sr("s_50", [Sine wave], [50]),
  ..sr("s_100", [Sine wave], [100]),
  ..sr("s_300", [Sine wave], [300]),
)
#v(3pt)
#prompt[At which frequency do the fine details of the sine start to disappear, and what is the highest frequency you would trust?]
#line_field("limit_note")

#pagebreak()
#section("SWEEP AND CONCLUSIONS", note: "Tasks A4, I3, C3")

*Frequency sweep* #h(6pt) #hint[1 Hz to 500 Hz, 200 samples per point]
#v(3pt)
#field_row(
  [Peak voltage constant across the sweep?], line_field("sweep_const"),
  [Frequencies with the largest deviation:], line_field("sweep_dev"),
  [Was 0.5 s settling enough?], line_field("sweep_settle"),
)
#v(4pt)
#prompt[How would you make this sweep more efficient without losing data quality?]
#area("sweep_opt", height: 44pt)

#closing(
  graph_prompt: [Plot voltage against time for the potentiometer run, or measured amplitude against frequency for the sweep.],
  graph_height: 138pt,
)
