#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 3.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 3.1 " + sym.dot.c + " Aliasing and anti-aliasing",
)

#section("PREDICT AND MEASURE THE ALIAS", note: "Tasks A1, A2, I1, I2")
#prompt[Sampling at $f_s = 1000$ Hz, so $f_N = 500$ Hz. Predict each FFT peak as homework, then read the measured peak off your own spectrum.]
#v(4pt)

#let al(id, f) = (
  f, line_field(id + "_pred"), line_field(id + "_phase"), line_field(id + "_meas"),
)
#table(
  columns: (auto, 1fr, 1fr, 1fr), align: horizon,
  table.header(
    [*True frequency*],
    [*Predicted FFT peak* \ #text(size: 7pt, weight: "regular")[A1]],
    [*Phase sign*],
    [*Measured FFT peak* \ #text(size: 7pt, weight: "regular")[I1]],
  ),
  ..al("f100", [100 Hz]), ..al("f450", [450 Hz]), ..al("f500", [500 Hz]),
  ..al("f650", [650 Hz]), ..al("f1100", [1100 Hz]),
)

#v(6pt)
*Square wave harmonics* #h(6pt) #hint[Tasks A2 and I2: 100 Hz square, odd harmonics]
#v(3pt)
#let hm(id, h) = (h, line_field(id + "_rel"), line_field(id + "_where"), line_field(id + "_meas"))
#table(
  columns: (auto, 1fr, 1fr, 1fr), align: horizon,
  table.header([*Harmonic*], [*Below, at or above $f_N$*], [*Predicted position after sampling*], [*Measured*]),
  ..hm("h1", [100 Hz]), ..hm("h3", [300 Hz]), ..hm("h5", [500 Hz]),
  ..hm("h7", [700 Hz]), ..hm("h9", [900 Hz]),
)

#v(6pt)
*Anti-aliasing filter* #h(6pt) #hint[Tasks A3 and I3: $R = 10$ k#sym.Omega, $f_c = 1 slash (2 pi R C)$]
#v(3pt)
#table(
  columns: (auto, 1fr, 1fr, 1.4fr), align: horizon,
  table.header([*Capacitor*], [*$f_c$ calculated*], [*Effect measured on the 700 and 900 Hz aliases*], [*Suitable? Why*]),
  [47 nF], line_field("c47_fc"), line_field("c47_eff"), line_field("c47_ok"),
  [100 nF], line_field("c100_fc"), line_field("c100_eff"), line_field("c100_ok"),
)

#pagebreak()
#section("EQUIVALENT TIME SAMPLING AND CONCLUSIONS", note: "Tasks I4, C1 to C3")

*Equivalent time sampling* #h(6pt) #hint[Task I4: 73 Hz sine]
#v(3pt)
#field_row(
  [Sampling rate used:], line_field("ets_fs"),
  [Points per reconstructed period:], line_field("ets_pts"),
  [Reconstructed frequency:], line_field("ets_f"),
)

#v(6pt)
*C1 Aliasing* #h(6pt) #prompt[What is aliasing and when does it occur? What is the highest component measurable at $f_s$? For a 500 Hz signal, which of 800, 1000, 1200 or 5500 Hz would you sample at, and why?]
#area("c1", height: 58pt)

#v(4pt)
*C2 Anti-aliasing* #h(6pt) #prompt[Explain how an RC low-pass filter prevents aliasing, and which capacitor you would pick for the Task I2 square wave.]
#area("c2", height: 50pt)

#v(4pt)
*C3 Equivalent time sampling* #h(6pt) #prompt[What must be true of the signal, what must be known about the timing, and what kind of event can never be reconstructed this way?]
#area("c3", height: 50pt)

#closing(
  graph: false,
)
