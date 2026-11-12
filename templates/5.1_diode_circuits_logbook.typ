#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 5.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 5.1 " + sym.dot.c + " Diode circuits",
)

#section("PREDICTION, SIMULATION, MEASUREMENT MATRIX", note: "Task C1")
#prompt[Fill the conduction rule first, from Task B2. A row where prediction and measurement disagree is the useful row, so name the cause rather than smoothing it over.]
#v(4pt)

#let dio(id, c, sim: none, meas: none) = (
  c,
  line_field(id + "_rule"),
  line_field(id + "_pred"),
  if sim == none { line_field(id + "_sim") } else { hint[#sim] },
  if meas == none { line_field(id + "_meas") } else { hint[#meas] },
  line_field(id + "_why"),
)
#table(
  columns: (1.1fr, 1fr, 1fr, 1fr, 1fr, 1.2fr), align: horizon,
  table.header(
    [*Circuit*], [*Conduction rule*], [*Predicted feature*],
    [*Simulated feature*], [*Measured feature*], [*Best explanation of mismatch*],
  ),
  ..dio("sc1", [Series clipper, 1 V]),
  ..dio("sh1", [Shunt clipper, 1 V]),
  ..dio("sh5", [Shunt clipper, 5 V]),
  ..dio("bias", [Biased clipper]),
  ..dio("sib", [Silicon bridge], meas: [not built]),
  ..dio("led", [ALPACA LED bridge], sim: [not simulated]),
)

#v(6pt)
*Bridge and ripple* #h(6pt) #hint[Tasks A3, A4, S2, I4]
#v(3pt)
#field_row(
  [Capacitor chosen, and the ripple it should give:], line_field("cap_choice"),
  [Ripple simulated:], line_field("ripple_sim"),
  [Load polarity and pulse count observed:], line_field("bridge_obs"),
)

#v(6pt)
*Setup* #h(6pt) #prompt[Sketch one bridge current path from the source, through two elements, to the load and back. Mark which two conduct.]
#v(3pt)
#sketchbox("setup", height: 150pt)

#section("GROUNDS AND CONCLUSIONS", note: "Tasks A5, S3, I5, C1, C2")

*Shared grounds* #h(6pt) #hint[Tasks S3 and I5]
#v(3pt)
#field_row(
  [What changed when the ground clip moved:], line_field("gnd_change"),
  [Device-model difference or grounding fault? How you told them apart:], line_field("gnd_diag"),
)

#v(6pt)
*C1 Reading the matrix* #h(6pt) #prompt[At which currents did the 0.7 V model predict your measurement well? The series and shunt clippers share a diode and a resistor, so name what decides the shape. Why do the LED bridge and the silicon bridge share a topology but not a waveform?]
#area("c1", height: 66pt)

#v(4pt)
*C2 TA check-off* #h(6pt) #prompt[State one condition under which the 0.7 V model is adequate and one under which it is not, citing your own rows above.]
#area("c2", height: 54pt)

#closing(
  graph: false,
)
