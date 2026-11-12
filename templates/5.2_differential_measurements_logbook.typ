#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 5.2",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 5.2 " + sym.dot.c + " Differential measurements",
)

#section("BALANCE AND COMMON-MODE REJECTION", note: "Tasks I1, I2, I3 and C1")
#prompt[Keep predictions and simulation traces beside this entry. Record raw readings before calculating gains. Voltages are in V.]
#v(3pt)
*Subtractor input test* #h(6pt) #hint[Task I2, reference at ground]
#v(3pt)
#let electrical(id, label) = (
  label, line_field(id + "_ul"), line_field(id + "_ur"), line_field(id + "_out"),
)
#table(
  columns: (1.6fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Nominal input pair*], [*$U_L$ measured*], [*$U_R$ measured*], [*$U_"out"$ measured*]),
  ..electrical("i2_plus", [0.5, 1.5]),
  ..electrical("i2_minus", [1.5, 0.5]),
  ..electrical("i2_low", [0.5, 0.5]),
  ..electrical("i2_high", [1.5, 1.5]),
)
#v(5pt)
#let gain(id, label) = (
  label, line_field(id + "_pred"), line_field(id + "_sim"), line_field(id + "_meas"),
)
#table(
  columns: (1.6fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Subtractor quantity*], [*Predicted, matched*], [*Simulated, matched*], [*Measured*]),
  ..gain("c1_ad", [$A_d$]),
  ..gain("c1_ac", [$A_c$]),
  ..gain("c1_cmrr", [CMRR (dB), or bound]),
)
#prompt[Measurement resolution used for the common-mode result:]
#line_field("i2_resolution")

#v(5pt)
*Equal illumination* #h(6pt) #hint[Tasks I1 and C1]
#v(3pt)
#let balance(id, label) = (
  label, line_field(id + "_before_ul"), line_field(id + "_before_ur"),
  line_field(id + "_after_ul"), line_field(id + "_after_ur"),
)
#table(
  columns: (1.25fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Light level*], [*$U_L$ before*], [*$U_R$ before*], [*$U_L$ after*], [*$U_R$ after*]),
  ..balance("i1_low", [Lower]),
  ..balance("i1_high", [Higher]),
)
#field_row(
  [Left feedback before / after (k#sym.Omega):], line_field("i1_rf_left"),
  [Right feedback (k#sym.Omega):], line_field("i1_rf_right"),
  [Imbalance follows sensor or channel after swap?], line_field("i1_swap"),
)

#v(5pt)
#pagebreak()
*Full detector* #h(6pt) #hint[Task I3]
#v(3pt)
#table(
  columns: (1.25fr, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Torch condition*], [*$U_L$*], [*$U_R$*], [*$U_"out"$*]),
  ..electrical("i3_left", [Left]),
  ..electrical("i3_centre", [Centre]),
  ..electrical("i3_right", [Right]),
)
#field_row(
  [Loaded $U_"ref"$ (V):], line_field("i3_reference"),
  [Verified output minimum / maximum (V):], line_field("i3_window"),
)
#grid(columns: (auto, 1fr), column-gutter: 5pt,
  check("i3_adc_check"), [ADC2 connected only after checking the output range and common ground.],
)

#v(4pt)
#prompt[Setup sketch, trace or display file reference; include any deep dive evidence:]
#line_field("c2_evidence")

#section("FIVE-LEVEL DETECTOR", note: "Tasks I4 and C2")
#set table(inset: 3pt)
#field_row(
  [Baseline (software units):], line_field("i4_baseline"),
  [Largest calibration departure (software units):], line_field("i4_noise"),
  [Deadband $D$ / strong threshold $H$ (software units):], line_field("i4_thresholds"),
)
#v(4pt)
#prompt[Use one baseline for the comparison. Record a limitation if a level cannot be reached within the verified ADC range.]
#v(3pt)
#let level(id, label) = (
  label, line_field(id + "_u"), line_field(id + "_corrected"), line_field(id + "_display"),
)
#table(
  columns: (1.2fr, 1fr, 1.1fr, 1.5fr), align: horizon,
  table.header([*Torch condition*], [*$U_"out"$ (V)*], [*Corrected reading*], [*Displayed level and label*]),
  ..level("i4_far_left", [Far left]),
  ..level("i4_left", [Left]),
  ..level("i4_centre", [Centre]),
  ..level("i4_right", [Right]),
  ..level("i4_far_right", [Far right]),
)
#v(5pt)
*Shared-light check after trimming* #h(6pt) #hint[No directional torch; keep the same baseline]
#v(3pt)
#table(
  columns: (1.2fr, 1fr, 1.1fr, 1.5fr), align: horizon,
  table.header([*Shared illumination*], [*$U_"out"$ (V)*], [*Corrected reading*], [*Displayed level*]),
  ..level("c2_ambient_low", [Lower]),
  ..level("c2_ambient_high", [Higher]),
)
#closing(
  graph: false,
)
