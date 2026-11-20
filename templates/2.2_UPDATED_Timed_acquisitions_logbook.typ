#import "../logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 2.2",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 2.2 " + sym.dot.c + " Timed acquisitions",
)

#field_row(
  [Prepared code file (Task S1):], line_field("s1_code_ref"),
)

#section("TIMING ACCURACY", note: "Tasks A1, I1, C1")
#prompt[Predict for 100 readings with a 50 ms target interval. Measure duration from the first reading to the last.]
#v(4pt)

#table(
  columns: (2fr, 1fr, 1fr, auto), align: horizon,
  table.header([*Parameter*], [*Predicted*], [*Measured*], [*Unit*]),
  [First-to-last duration], line_field("dur_pred"), line_field("dur_meas"), [s],
  [Sampling interval (target)], line_field("int_pred"), line_field("int_meas"), [ms],
  [Minimum measured interval], line_field("min_pred"), line_field("min_meas"), [ms],
  [Maximum measured interval], line_field("max_pred"), line_field("max_meas"), [ms],
  [Average measured interval], line_field("avg_pred"), line_field("avg_meas"), [ms],
  [Interval range (maximum $-$ minimum)], line_field("jit_pred"), line_field("jit_meas"), [ms],
)
#v(3pt)
#field_row(
  [Timing function used (`ticks_ms` or `ticks_us`), and why:], line_field("ticks_choice"),
  [Maximum timing error as a % of the 50 ms target:], line_field("err_pct"),
)

#v(6pt)
#section("SAMPLING RATE LIMITS", note: "Tasks A2, I2, I4, C2")
#let sr(id, sig, f) = (
  sig, f, line_field(id + "_req"), line_field(id + "_ach"), line_field(id + "_ok"),
)
#table(
  columns: (1.4fr, 0.7fr, 1.2fr, 1.2fr, 0.9fr), align: horizon,
  table.header(
    [*Signal type*], [*Test $f$ [Hz]*],
    [*Minimum required rate [Hz]*], [*Achieved rate [Hz]*], [*Sufficient?*],
  ),
  ..sr("s_pot", [Potentiometer (slow)], [Not periodic]),
  ..sr("s_50", [Sine wave], [50]),
  ..sr("s_100", [Sine wave], [100]),
  ..sr("s_300", [Sine wave], [300]),
)
#v(3pt)
#prompt[Do the sine-wave measurements meet the timing checks? What is the highest tested frequency whose ADC trace agrees with the scope?]
#line_field("limit_note")

#pagebreak()
#section("SWEEP AND CONCLUSIONS", note: "Tasks A4, I3, I4, C3")

*Frequency sweep* #h(6pt) #hint[10 Hz to 300 Hz, 1000 samples per point at a 0.2 ms target interval]
#v(3pt)
#field_row(
  [Helper amplitude setting [Vpp]:], line_field("i3_helper_vpp"),
  [Scope picture (Task I3):], line_field("i3_scope_capture"),
)
#v(3pt)
#prompt[For each setting, record the scope frequency, voltage range and peak-to-peak voltage. Do the same for signal measured by the ADC from Task I4:]
#area("i3_scope_range", height: 62pt)
#v(3pt)
#field_row(
  [Do the ADC and scope voltages agree?], line_field("sweep_const"),
  [Frequency with the largest ADC/scope difference:], line_field("sweep_dev"),
  [How would you check the settling time?], line_field("sweep_settle"),
)
#v(4pt)
#prompt[How would you make this sweep more efficient without losing data quality?]
#area("sweep_opt", height: 44pt)

#closing(
  graph_prompt: [Plot ADC and scope peak voltages against frequency, or the potentiometer voltage against time.],
  graph_height: 138pt,
)
