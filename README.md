# Mission Simulator: first version

A browser game: the player becomes the commander of a spacecraft, chooses a mission, checks resources and equipment, solves physics and astronomy tasks, makes decisions in an emergency and gets a score for the flight.

This version has one complete mission: "Research Satellite Rescue".

## How to open

1. Double-click `index.html`. The game runs in any modern browser, no internet needed.
2. If the browser blocks something, start a small server in the game folder and open the address in a browser:
   ```
   python3 -m http.server 8000
   ```
   Address: http://localhost:8000
3. To play on a phone, the game has to be put online (for example GitHub Pages or Netlify: free, all it needs is the folder of files). This has not been done yet.

No build step: this is plain HTML, CSS and JavaScript with no libraries.

## Files

| File | What's inside |
|---|---|
| `index.html` | The game page. Loads three scripts in order. |
| `css/style.css` | Styling. All colors are at the top of the file (`:root`), change them there. |
| `js/physics.js` | Formulas: orbital velocity, period, Hohmann transfer, Tsiolkovsky rocket equation. |
| `data/missions.js` | **All missions, tasks and emergencies.** To add content, change only this file. |
| `js/engine.js` | Engine: shows the steps, checks answers, tracks resources and the score. |
| `assets/icon.svg` | Icon. |

## How a mission works

A mission is a list of steps (`steps`). The game goes through them from top to bottom. Step types:

| Type | What it is | Example in mission 1 |
|---|---|---|
| `briefing` | Introduction | Briefing |
| `check` | Pre-launch systems check, one random system is broken each run and has solution options | Suit leak, fuel leak, sticking engine valve... |
| `numeric` | Task with a numeric answer, checked within a tolerance | Oxygen, transfer time, fuel |
| `choice` | Multiple choice, each option has its own consequences | Choosing the orbit, lost contact |
| `shutdown` | Power emergency: the player switches systems off | Damaged solar panel |
| `event` | Story scene: time passes, resources are spent | Liftoff, approach, return |

The full schema of all the fields is in the comment at the top of `data/missions.js`.

**Resources.** The ship has three resources: fuel (kg), oxygen (kg), energy (kWh). They change through `effects` on steps and answer options. Oxygen is also used automatically: the crew breathes every hour (`hours` on a step). If a resource runs out, the mission fails.

**Flags.** A decision can set a flag (`flag: 'suitLeak'`), and later a step or option checks it (`ifFlag`). This is how a decision at the start affects the end of the mission: if you don't replace the suit valve, it leaks during the spacewalk.

**Pre-launch faults.** Every system in a `check` step that has a `fault` can break. On each run exactly one does: the game goes through all of them before repeating one, and remembers which ones have come up in the browser's `localStorage` (if storage is blocked, it remembers until the page is closed). In mission 1 all six systems can break:

| System | Fault | If you launch without fixing it | Flag |
|---|---|---|---|
| Propulsion system | Main fuel valve opens late | 8% more fuel on the transfer | `engineFault` |
| Fuel tanks | Feed line leaks 15 kg/h | 150 kg lost while waiting in orbit | `fuelLeak` |
| Oxygen supply | Tank valve leaks 0.15 kg/h | 1.5 kg lost while waiting in orbit | `o2Leak` |
| Battery and solar panels | Module overheats | 2 kWh lost in orbit, so the Mission Control link has to go in the emergency | `batteryFault` |
| Link to Mission Control | Amplifier overheats | Link lost on approach: 30 kg of fuel and 0.3 kWh | `commsFault` |
| EVA spacesuit | Valve leaks 0.25 kg/h | Oxygen lost on every spacewalk | `suitLeak` |

Launching with a fault costs 15% safety at once and another 10% when the consequence hits. Fixing a fault always costs the same 1-hour delay and 0.5 kWh, so `targets` and the maximum score of 100 hold whichever system breaks. To add a fault, add a `fault` to a system in `data/missions.js` and, if it has later consequences, `ifFlag` to the steps it affects.

## How to add a task

Insert an object into the `steps` of the mission, at the point where the task should appear:

```js
{
  id: 'sat-speed', type: 'numeric', title: 'Task: satellite speed',
  givens: ['Earth’s GM = 3.986 · 10¹⁴ m³/s²', 'Orbit radius r = 7,171 km'],
  question: 'How fast is the satellite flying? Answer in km/s.',
  unit: 'km/s',
  answer: P.circularVelocity(P.radius(800)) / 1000,   // can be a plain number: 7.455
  tolerance: 0.03,                                    // accept ±3%
  points: 10,
  hint: 'v = √(GM / r)',
  formula: 'Circular velocity: v = √(GM / r)',
  solution: 'v = √(3.986 · 10¹⁴ / 7.171 · 10⁶) ≈ <b>7.46 km/s</b>',
  onWrong: { fuel: -30, text: 'Inaccurate speed: the orbit had to be corrected.' }
}
```

It is better to compute the correct answer with a formula from `js/physics.js` (the `P` variable) than to type it in by hand: then the answer updates itself when the numbers in the problem change. The tolerance can be a percentage (`tolerance: 0.03` means ±3%) or in units (`toleranceAbs: 0.2`). If a task has a second valid method (for example an approximate formula), add it to `alsoAccept: [{ value, tolerance, note }]`.

Answer options in `choice`, fault options in `check` and systems in `shutdown` appear in random order, so the right answer isn't always first. To turn shuffling off, set `shuffle: false` on the step.

For a multiple-choice task:

```js
{
  id: 'orbit-2', type: 'choice', title: 'Task: ...', question: '...', points: 10,
  explanation: 'Why the right answer is right',
  options: [
    { text: 'Option 1', correct: true, feedback: 'What happened' },
    { text: 'Option 2', correct: false, feedback: 'What happened', hours: 1.5,
      effects: { fuel: -100, safety: -10, log: 'Flight log entry' } }
  ]
}
```

## How to add an emergency

Power emergency (type `shutdown`): set a list of consumers, a duration and a reserve.

```js
{
  id: 'emergency-2', type: 'shutdown', title: 'EMERGENCY: ...',
  text: ['What happened'], hours: 4, reserve: 2, points: 10,
  formula: 'E = P · t',
  consumers: [
    { name: 'Life support', power: 0.6, role: 'critical', offText: 'Why not' },
    { name: 'Radar', power: 0.25, role: 'needed', offSafety: -10, offText: 'What will happen' },
    { name: 'Lighting', power: 0.15, role: 'optional' }
  ]
}
```

Roles: `critical` (switching off = failure), `needed` (switching off = no points and a safety penalty), `useful` (safety penalty only), `optional` (fine to switch off).

Make any other emergency (for example a comms failure) a `choice` step: the emergency text in `text`, the decisions in `options`, each decision with its own `effects`.

## How to add a mission

`data/missions.js` already has two stubs with `locked: true` ("Station Docking", "Moon Landing"). Fill in `crew`, `o2PerPersonHour`, `resources`, `success`, `targets` and `steps` (as in the first mission) and remove `locked`. The mission will appear in the menu right away. For a `check` step, give every system that can break a `fault`, and the mission gets a different fault each run with no engine changes.

`targets` is how many resources are left after a perfect run. Play the mission without mistakes: at the end the game prints the remainder to the browser console (F12), put those numbers in.

## How the score works

| Part | Points | How it is calculated |
|---|---|---|
| Tasks | 40 | share of task points earned; a task with a hint is worth half |
| Safety | 30 | starts at 100%, risky decisions take percentages off |
| Resources | 30 | 10 each for fuel, oxygen and energy: the remainder divided by `targets` |

Each part is rounded, and the total is the sum of the parts. If the mission is not accomplished (contact not restored, a resource ran out, mission aborted), resources earn no points. The top rank, "Elite Commander", requires safety of 90% or higher.

## For the team: physics and simplifications

All formulas are real, and the numbers in the tasks are calculated from them (`js/physics.js`). What is simplified and why:

1. **Orbits are circular and in the same plane.** The ship and satellite fly in circles in one plane. In reality orbits are slightly elongated and inclined, and changing inclination costs a lot of fuel.
2. **Hohmann transfer.** The flight from a 300 km to an 800 km orbit is along an ellipse touching both orbits. The transfer time is half the period of the ellipse by Kepler's third law: t = π · √(a³ / GM), a = (r₁ + r₂) / 2. This gives ≈ 47.8 min, tolerance ±2%. The wrong method a = R + (h₂ − h₁) happens to give 47.2 min and falls within tolerance: this coincidence can't be ruled out without penalizing rounding.
3. **Δv is given.** The engine calculates the speed change (274 m/s = 138 + 136) with the vis-viva equation, which isn't in the school curriculum, so the student is given Δv in the problem.
4. **Fuel by the Tsiolkovsky rocket equation**: m = m₀ · (1 − e^(−Δv/u)), u = 3,000 m/s (a typical storable-propellant engine). The answer is ≈ 1,047 kg, tolerance ±3%. The approximation m ≈ m₀ · Δv / u gives 1,096 kg (4.6% more): it is accepted separately as a second valid method (`alsoAccept`), also with ±3%. The mass in the problem is the full 12 t; the formula accounts for the ship getting lighter between burns.
5. **Phasing isn't calculated.** Waiting for the satellite to reach the right point is shown as a "10 hours passed" scene. If the window is missed (wrong orbit or wrong transfer time), the next one opens after the synodic period: 1/S = 1/T₁ − 1/T₂, where T₁ ≈ 90.4 min (300 km) and T₂ ≈ 100.7 min (800 km). This gives S ≈ 14.7 h. This is real physics: the ship overtakes the satellite slowly, so the wait is long. Each missed window costs the crew ≈ 1.5 kg of oxygen.
6. **Oxygen**: 0.84 kg per person per day (the usual figure for crewed flight planning), or 0.035 kg per hour. There are 10 kg on board, and 2 days of breathing takes 5.04 kg. A spacewalk costs 1.2 kg (suit and airlock losses): this is a game estimate, not an exact figure. The suit valve leak is 0.25 kg/h.
7. **Energy**: E = P · t. The system powers (0.15 to 0.6 kW) and the 14 kWh battery capacity are made up for the game, but the orders of magnitude are reasonable for a small ship. While the panel works, we assume it covers current consumption, so energy is only spent in specific events. After the emergency the panel is only partly repaired, so the approach and the satellite repair run on the battery. In the emergency the game shows only the total power P: the player works out E = P · t.
8. **Wrong orbits** (via a 1,500 km circular orbit, via 200 km) are calculated honestly as two Hohmann transfers in a row: 952 m/s and 391 m/s instead of 274 m/s. Mission Control cancels them, so the player loses time (a missed window), not fuel.
9. **The return** is a reverse Hohmann transfer with the same Δv; it takes a little less fuel (≈ 951 kg) because the ship is lighter. Deorbit and landing aren't calculated separately.
10. **Small maneuvers** (approach 40 kg, satellite flyaround 20 kg) are game estimates. So are the pre-launch fault figures (the constants `ENGINE_LOSS`, `FUEL_LEAK`, `O2_LEAK`, `BATTERY_LOSS`, `COMMS_FUEL`, `COMMS_ENERGY`).

If the team changes the orbit altitudes, ship mass, exhaust velocity, oxygen supply or schedule, change the constants at the top of `data/missions.js` (`H1`, `H2`, `SHIP_MASS`, `U`, `O2_ON_BOARD`, `LAUNCH_WAIT` and others): the answers, solution texts and return duration (`returnH`, so the mission fits in 2 days) will recalculate themselves.

Written directly in the text (not from formulas): the altitudes 300 and 800 km in the story and in the orbit choice options, the 12 t mass and 2,600 kg of fuel, the system powers in the emergency, the 3 kWh reserve, the 1.5 kWh in the "full-power commands" option, the 80 kg for the robotic arm, the 0.5 kWh for a liftoff delay, the 5 km and 50 m distances and the 6 m satellite width. If the constants change, these need to be corrected by hand.

## What's left for the team

**Design**
- Illustrations: ship, satellite, liftoff and spacewalk scenes (for now only the orbit diagram and the icon).
- Animation of the flight along the ellipse on the diagram.
- Sound (liftoff, alarm, success), a mute button.
- A logo and ship name, if you want your own.

**Content**
- The "Station Docking" and "Moon Landing" missions (stubs are already in the menu).
- A second emergency to choose from (for example a comms failure) and random emergency selection.
- More tasks: orbital velocity, satellite period, a phasing task (what angle the satellite should lead the ship by before the transfer).
- Difficulty levels: on easy show the hint right away, on hard use a smaller tolerance.

**Programming**
- Put the game online (GitHub Pages or Netlify) so it can be played on a phone from a link.
- Saving the best result and a leaderboard.
- A player counter: how many people have finished the mission. It will show how many people actually play.
- Automated tests for answer checking and scoring.

## What was tested in this version

- A full run without mistakes for each of the six pre-launch faults: 100 out of 100.
- A run launching with each of the six faults unfixed: the consequence fires and the mission can still be finished.
- Faults do not repeat until all six have come up, including after a page reload.
- Number input in English and European formats (`1,047`, `1 047`, `5.04`, `5,04`, `5.04 kg`, `5.`).
- Desktop and phone (375 px) screens.
# Demo-Starburst



