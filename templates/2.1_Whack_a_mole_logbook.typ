#import "logbook_common.typ": *

#show: logbook.with(
  title: "Log Book Entry 2.1",
  subtitle: "NB2420 Electronic Instrumentation " + sym.dot.c + " Manual 2.1 " + sym.dot.c + " Whack-a-mole",
)

#section("BUILD AND INVESTIGATE", note: "Tasks A1, A2, I1 to I5. This manual has no simulate task.")

*Pull configuration* #h(6pt) #hint[Tasks A1, A2 and I1]
#v(3pt)
#table(
  columns: (1.1fr, 1fr, 1fr, 1fr, 1fr), align: horizon,
  table.header(
    [*Configuration*],
    [*Pin, not pressed* \ #text(size: 7pt, weight: "regular")[predicted]],
    [*Pin, pressed* \ #text(size: 7pt, weight: "regular")[predicted]],
    [*Pin, not pressed* \ #text(size: 7pt, weight: "regular")[measured]],
    [*Pin, pressed* \ #text(size: 7pt, weight: "regular")[measured]],
  ),
  [Pull-up], line_field("pu_np_pred"), line_field("pu_p_pred"), line_field("pu_np_meas"), line_field("pu_p_meas"),
  [Pull-down], line_field("pd_np_pred"), line_field("pd_p_pred"), line_field("pd_np_meas"), line_field("pd_p_meas"),
)
#v(3pt)
#prompt[Which way round did the LED have to go before it lit, and how did you know?]
#line_field("led_orientation")

#v(6pt)
*Game features* #h(6pt) #prompt[Tick what your game does, and name the pins you used.]
#v(3pt)
#grid(
  columns: (auto, 1.1fr, auto, 1fr), column-gutter: 6pt, row-gutter: 7pt, align: horizon,
  check("f_led"), [LED lights on a button press], [Input pin(s):], line_field("pins_in", height: 14pt),
  check("f_random"), [Moles appear in a random hole], [Output pin(s):], line_field("pins_out", height: 14pt),
  check("f_score"), [Score counts a successful hit], [Reaction time measured:], line_field("react", height: 14pt),
  check("f_timing"), [Game ends after a set time], [Rounds per game:], line_field("rounds", height: 14pt),
)

#v(6pt)
*Troubleshooting log* #h(6pt) #hint[Task C2. This table is the point of the manual, so fill it as you go, not afterwards.]
#v(3pt)
#let tr(i) = (line_field("sym" + str(i)), line_field("cause" + str(i)), line_field("fix" + str(i)))
#table(
  columns: (1fr, 1fr, 1fr), align: horizon,
  table.header([*Symptom you saw*], [*Cause you found*], [*What fixed it*]),
  ..tr(1), ..tr(2), ..tr(3), ..tr(4),
)

#v(6pt)
#pagebreak()
*C1 Pull configuration and LEDs* #h(6pt) #prompt[How must an LED be connected to light? What does a pin read when the button is not pressed, pull-up and pull-down? Why is the resistor necessary? If the LED lights on release rather than press, what does that tell you?]
#area("c1", height: 74pt)

#closing(
  graph: false,
)
