/*
 * MISSIONS AND TASKS. This is the only file you need to change to add a mission,
 * task or emergency. The engine (js/engine.js) does not need to be touched.
 *
 * MISSION SCHEMA
 * {
 *   id: 'unique-id',
 *   title: 'Title', subtitle: 'Short description for the card', difficulty: 'Easy',
 *   locked: true,                     // optional: "Coming soon" card, the mission cannot be started
 *   crew: 3,                          // crew size
 *   o2PerPersonHour: 0.035,           // oxygen use, kg per person per hour
 *   resources: { fuel: 2600, o2: 10, energy: 14 },      // start: kg, kg, kWh
 *   success: { flag: 'restored' },    // which flag must be set for success
 *   targets: { fuel: 540, o2: 3.75, energy: 2.4 },      // remainder after a perfect run (for resource points)
 *   steps: [ ...steps... ]
 * }
 *
 * COMMON STEP FIELDS
 *   id, type, title, text: ['paragraph', 'paragraph'] (HTML allowed: <b>, <sub>, <sup>)
 *   hours: 2                    // how many flight hours pass (the crew breathes: O₂ is used automatically)
 *   effects: { fuel: -40, o2: 0, energy: -0.8, safety: -5, flag: 'name', log: 'flight log entry' }
 *   ifFlag: { flagName: { effects, feedback } }   // numeric and event steps: extra consequences if the flag is set
 *   failText: 'text'            // what to show if a resource runs out on this step
 *   onlyIf: 'flag' / unless: 'flag'   // show the step only if the flag is set / not set
 *   diagram: { type: 'hohmann', h1: 300, h2: 800, transfer: false }  // orbit diagram;
 *                               // transfer: false hides the transfer ellipse until the answer
 *   shuffle: false              // do not shuffle the options (they are shuffled by default)
 *
 * STEP TYPES
 *   briefing  : introduction. button: 'button text'
 *   check     : pre-launch check. systems: [{ name, okText, fault: { faultText, options: [option, ...] } }]
 *               Every run exactly one system with a `fault` is broken, the rest report okText.
 *               The game goes through all the faults before repeating one.
 *   numeric   : task with a numeric answer.
 *               givens: ['given', ...], question, unit, answer (number), tolerance: 0.03 (±3%)
 *               or toleranceAbs: 0.1, points, hint (formula without numbers, costs half the points),
 *               alsoAccept: [{ value, tolerance, note }]  // another valid method (e.g. an approximation)
 *               formula (formula after the answer), solution (worked solution with numbers),
 *               onCorrect: {effects}, onWrong: {effects, text: 'what happened'}
 *   choice    : multiple choice. question, points, explanation (after the answer),
 *               options: [option, ...]
 *   shutdown  : power emergency. hours, reserve (kWh to keep), points,
 *               consumers: [{ name, power (kW), role: 'critical'|'needed'|'useful'|'optional',
 *                             offText, offSafety }]
 *               critical switched off = mission failed; needed switched off = no points and a safety penalty
 *   event     : story scene: text + effects + time.
 *
 * ANSWER OPTION (in check and choice)
 *   { text, correct: true/false, feedback: 'what happened', effects: {...}, hours,
 *     goto: 'step id',               // jump to a step (e.g. to abort the mission)
 *     fail: 'reason',                // this option fails the mission
 *     ifFlag: { flagName: { effects, feedback } } }  // extra consequences if the flag is set
 */

(function () {
  const P = window.Physics;

  // ---- Calculations for mission 1 (every number in the tasks comes from here) ----
  const H1 = 300, H2 = 800;                  // orbit altitudes, km
  const r1 = P.radius(H1), r2 = P.radius(H2);
  const hoh = P.hohmann(r1, r2);
  const DV = Math.round(hoh.dv);             // 274 m/s
  const SHIP_MASS = 12000, U = 3000;         // kg, m/s
  const burnFuel = P.fuelMass(SHIP_MASS, DV, U);           // ≈ 1047 kg
  const linearFuel = SHIP_MASS * DV / U;                   // ≈ 1096 kg, approximation
  const transferMin = hoh.time / 60;                       // ≈ 47.8 min
  const T1 = P.period(r1), T2 = P.period(r2);              // ≈ 90.4 and 100.7 min
  const missedWindowH = P.synodic(T1, T2) / 3600;          // ≈ 14.7 h until the next window
  const r1500 = P.radius(1500);
  const viaHigh = P.hohmann(r1, r1500).dv + P.hohmann(r1500, r2).dv;   // via a 1500 km circular orbit
  const viaLow = P.hohmann(r1, P.radius(200)).dv + P.hohmann(P.radius(200), r2).dv;
  const fuelViaHigh = P.fuelMass(SHIP_MASS, viaHigh, U);
  const fuelViaLow = P.fuelMass(SHIP_MASS, viaLow, U);
  const APPROACH_FUEL = 40, INSPECT_FUEL = 20;
  const returnFuel = P.fuelMass(SHIP_MASS - burnFuel - APPROACH_FUEL - INSPECT_FUEL, DV, U);

  // Mission schedule (hours). The return takes whatever is left of the 2-day plan.
  const PLAN_HOURS = 48;
  const LAUNCH_WAIT = 10, EMERGENCY_H = 6, RDV_H = 2, INSPECT_H = 1, REPAIR_H = 4;
  const transferH = hoh.time / 3600;
  const returnH = PLAN_HOURS - (LAUNCH_WAIT + transferH + EMERGENCY_H + RDV_H + INSPECT_H + REPAIR_H);

  // Oxygen
  const CREW = 3, O2_PER_DAY = 0.84, O2_ON_BOARD = 10, EVA_O2 = 1.2, LEAK = 0.25;
  const o2Need = CREW * O2_PER_DAY * PLAN_HOURS / 24;      // 5.04 kg

  // Pre-launch faults: what each one costs if the crew launches without fixing it
  const ENGINE_LOSS = 0.08, FUEL_LEAK = 15, O2_LEAK = 0.15, BATTERY_LOSS = 2, COMMS_FUEL = 30, COMMS_ENERGY = 0.3;

  const f0 = (x) => Math.round(x).toLocaleString('en-US');
  const f1 = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const f2 = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const missedWindowText = 'The transfer window was missed. The next one opens in ' + f1(missedWindowH) + ' h: that is how long the ship needs to get back into the right position relative to the satellite.';

  // Every fix costs the same 1-hour delay, so `targets` holds whichever system breaks
  const fix = (text, feedback, log) => ({
    text, correct: true,
    feedback: feedback + ' While waiting on the pad, the onboard systems used 0.5 kWh. The mission clock (T+) starts at liftoff.',
    effects: { energy: -0.5, log }
  });
  const risk = (text, feedback, flag, log) => ({ text, correct: false, feedback, effects: { safety: -15, flag, log } });

  window.MISSIONS = [
    {
      id: 'satellite-rescue',
      title: 'Research Satellite Rescue',
      subtitle: 'The Zhuldyz-1 satellite in an 800 km orbit has stopped transmitting data. Fly out, inspect it, restore contact.',
      difficulty: 'Medium',
      crew: CREW,
      o2PerPersonHour: O2_PER_DAY / 24,
      resources: { fuel: 2600, o2: O2_ON_BOARD, energy: 14 },
      success: { flag: 'restored' },
      targets: { fuel: 540, o2: 3.75, energy: 2.4 },
      steps: [
        {
          id: 'brief', type: 'briefing', title: 'Briefing',
          text: [
            'You are the commander of the spacecraft <b>Sunkar</b>. Three days ago the research satellite <b>Zhuldyz-1</b>, in a circular orbit at <b>800 km</b>, stopped transmitting data.',
            'The rocket will put the ship into a <b>300 km</b> parking orbit. From there it is up to you: fly to the satellite, find the fault, restore contact and come home.',
            'The ship: mass 12 t, crew of 3, fuel 2,600 kg, oxygen ' + f0(O2_ON_BOARD) + ' kg, battery 14 kWh. Mission plan: 2 days.',
            'At the end of the flight, Mission Control will assess whether the objective was met, how many resources are left, how safe your decisions were and whether you solved the tasks correctly.'
          ],
          button: 'Go to pre-launch check'
        },
        {
          id: 'precheck', type: 'check', title: 'Pre-launch check',
          text: ['Before liftoff, check the supplies and the condition of every system. Click a system to run diagnostics.'],
          systems: [
            {
              name: 'Propulsion system', okText: 'Thrust nominal, valves sealed.',
              fault: {
                faultText: 'In the test firing, the main fuel valve opens late. Every burn would run longer than planned and waste about <b>' + Math.round(ENGINE_LOSS * 100) + '% more fuel</b>.',
                options: [
                  fix('Replace the valve. Liftoff slips by 1 hour.', 'Valve replaced, the test firing is clean.', 'Main fuel valve replaced before liftoff'),
                  risk('Fly as is. The engine does fire, after all.', 'Liftoff on schedule, but with a faulty main engine valve on board: a risk to the crew and to the fuel budget.', 'engineFault', 'Launched with a faulty main fuel valve')
                ]
              }
            },
            {
              name: 'Fuel tanks', okText: '2,600 kg of fuel loaded.',
              fault: {
                faultText: 'Pressure is dropping in tank 2: a seal on the feed line is leaking <b>' + FUEL_LEAK + ' kg of fuel per hour</b>.',
                options: [
                  fix('Replace the seal. Liftoff slips by 1 hour.', 'Seal replaced, tank pressure is steady.', 'Fuel line seal replaced before liftoff'),
                  risk('Fly as is. There is plenty of fuel.', 'Liftoff on schedule, but with a fuel leak on board: a risk to the crew and to the trip home.', 'fuelLeak', 'Launched with a fuel line leak')
                ]
              }
            },
            {
              name: 'Oxygen supply', okText: f0(O2_ON_BOARD) + ' kg of oxygen on board.',
              fault: {
                faultText: 'A valve on the oxygen tank is not seating properly: it is leaking <b>' + f2(O2_LEAK) + ' kg of oxygen per hour</b>.',
                options: [
                  fix('Replace the valve. Liftoff slips by 1 hour.', 'Valve replaced, no more leak.', 'Oxygen tank valve replaced before liftoff'),
                  risk('Fly as is. The reserve should cover it.', 'Liftoff on schedule, but the crew’s oxygen is leaking away: a serious risk.', 'o2Leak', 'Launched with an oxygen tank leak')
                ]
              }
            },
            {
              name: 'Battery and solar panels', okText: 'Charge 14 kWh, panels deploy correctly.',
              fault: {
                faultText: 'One battery module failed the load test and is overheating. In flight it would have to be disconnected, taking about <b>' + BATTERY_LOSS + ' kWh of charge</b> with it.',
                options: [
                  fix('Replace the module. Liftoff slips by 1 hour.', 'Module replaced, the battery passes the load test.', 'Battery module replaced before liftoff'),
                  risk('Fly as is. The other modules will carry the load.', 'Liftoff on schedule, but with an overheating battery module on board: a risk to the crew and to the power budget.', 'batteryFault', 'Launched with a faulty battery module')
                ]
              }
            },
            {
              name: 'Link to Mission Control', okText: 'Communication link is stable.',
              fault: {
                faultText: 'The main transmitter amplifier is overheating and <b>the link keeps dropping</b> for several seconds at a time.',
                options: [
                  fix('Swap in the spare amplifier. Liftoff slips by 1 hour.', 'Amplifier swapped, the link is stable.', 'Transmitter amplifier swapped before liftoff'),
                  risk('Fly as is. The link mostly works.', 'Liftoff on schedule, but with an unreliable link to Mission Control: a risk to the crew.', 'commsFault', 'Launched with an unreliable communication link')
                ]
              }
            },
            {
              name: 'EVA spacesuit', okText: 'Suit is sealed, life support pack charged.',
              fault: {
                faultText: 'A sensor shows a leak through a valve: <b>' + f2(LEAK) + ' kg of oxygen per hour</b>. The suit will be needed if someone has to go out to the satellite.',
                options: [
                  fix('Replace the valve. Liftoff slips by 1 hour.', 'Valve replaced, no more leak.', 'Spacesuit valve replaced before liftoff'),
                  risk('Fly as is. Maybe the valve will hold.', 'Liftoff on schedule, but with a faulty spacesuit on board: a risk to the crew.', 'suitLeak', 'Launched with a leaking spacesuit')
                ]
              }
            }
          ]
        },
        {
          id: 'o2', type: 'numeric', title: 'Task: is there enough oxygen?',
          givens: ['Crew: 3 people', 'One person uses 0.84 kg of oxygen per day', 'Mission plan: 2 days', f0(O2_ON_BOARD) + ' kg of oxygen on board'],
          question: 'How many kilograms of oxygen will the crew breathe over the whole mission?',
          unit: 'kg', answer: o2Need, tolerance: 0.03, points: 10,
          hint: 'm = N · q · t',
          formula: 'm = N · q · t (people × use per person per day × days)',
          solution: 'm = 3 · 0.84 · 2 = <b>' + f2(o2Need) + ' kg</b>. There are ' + f0(O2_ON_BOARD) + ' kg on board, so there is enough oxygen with a margin of ' + f2(O2_ON_BOARD - o2Need) + ' kg. The margin is for the unexpected.',
          onWrong: { energy: -0.5, text: 'Mission Control rechecks the calculation and liftoff is delayed. While waiting on the pad, the onboard systems used 0.5 kWh.' }
        },
        {
          id: 'launch', type: 'event', title: 'Liftoff!',
          text: [
            'The rocket has put Sunkar into a circular <b>300 km</b> parking orbit.',
            'The satellite flies higher and slower. The ship waits for the transfer window: the moment when the satellite reaches the right point in its orbit. ' + LAUNCH_WAIT + ' hours have passed.'
          ],
          hours: LAUNCH_WAIT, effects: { energy: -1, log: 'Transfer window to the satellite opened' },
          ifFlag: {
            fuelLeak: { effects: { fuel: -FUEL_LEAK * LAUNCH_WAIT, safety: -10, log: 'Fuel leak isolated in orbit' }, feedback: 'While waiting for the window, the leaking seal lost ' + f0(FUEL_LEAK * LAUNCH_WAIT) + ' kg of fuel before the crew could isolate the line.' },
            o2Leak: { effects: { o2: -O2_LEAK * LAUNCH_WAIT, safety: -10, log: 'Oxygen leak isolated in orbit' }, feedback: 'While waiting for the window, the faulty valve lost ' + f2(O2_LEAK * LAUNCH_WAIT) + ' kg of oxygen before the crew could close off the line.' },
            batteryFault: { effects: { energy: -BATTERY_LOSS, safety: -10, log: 'Faulty battery module disconnected in orbit' }, feedback: 'In orbit the faulty module overheated and had to be disconnected: ' + BATTERY_LOSS + ' kWh of charge lost.' }
          }
        },
        {
          id: 'orbit', type: 'choice', title: 'Task: choose the intercept orbit',
          diagram: { type: 'hohmann', h1: H1, h2: H2, transfer: false },
          question: 'The ship is in a 300 km circular orbit, the satellite is in an 800 km circular orbit. Which trajectory uses the least fuel?',
          points: 10,
          explanation: 'The most economical path between two circular orbits with two engine burns is a <b>Hohmann transfer</b>. It is an ellipse whose lowest point (perigee) touches your orbit and whose highest point (apogee) touches the satellite’s orbit. The engine fires twice: at perigee to enter the ellipse, and at apogee to stay in the satellite’s orbit. For 300 → 800 km this is Δv ≈ ' + DV + ' m/s.',
          options: [
            {
              text: 'An ellipse with its lowest point at 300 km and its highest point at 800 km', correct: true,
              feedback: 'Correct. The ellipse touches both orbits, which takes the least fuel.'
            },
            {
              text: 'Climb to a 1,500 km circular orbit, then descend to 800 km', correct: false,
              feedback: 'That path requires Δv ≈ ' + f0(viaHigh) + ' m/s, or ≈ ' + f0(fuelViaHigh) + ' kg of fuel, and the tanks hold 2,600 kg. Mission Control canceled the maneuver. ' + missedWindowText,
              hours: missedWindowH, effects: { log: 'Wrong orbit chosen (via 1,500 km), Mission Control canceled the maneuver' }
            },
            {
              text: 'Drop to 200 km to fly faster and catch up with the satellite', correct: false,
              feedback: 'Lower down the ship does fly faster, but the satellite is higher, so you would have to climb anyway. Δv ≈ ' + f0(viaLow) + ' m/s, or ≈ ' + f0(fuelViaLow) + ' kg instead of ' + f0(burnFuel) + ' kg. Mission Control canceled the maneuver. ' + missedWindowText,
              hours: missedWindowH, effects: { log: 'Wrong orbit chosen (via 200 km), Mission Control canceled the maneuver' }
            },
            {
              text: 'Point the engine straight up, toward the satellite', correct: false,
              feedback: 'You cannot fly “in a straight line” in orbit: the ship is moving sideways at ' + f1(P.circularVelocity(r1) / 1000) + ' km/s. A push upward only stretches the orbit: it rises on one side of the Earth and drops on the other, while the ship gains almost no energy. Accelerating along the direction of motion works best. Mission Control canceled the maneuver. ' + missedWindowText,
              hours: missedWindowH, effects: { log: 'Attempted to fly straight up, Mission Control canceled the maneuver' }
            }
          ]
        },
        {
          id: 'transfer-time', type: 'numeric', title: 'Task: transfer time',
          diagram: { type: 'hohmann', h1: H1, h2: H2 },
          text: ['To meet the satellite at apogee, you need to know how long the transfer takes: the engine fires early, while the satellite has not yet reached the meeting point.'],
          givens: ['Earth’s radius R = 6,371 km', 'Ship altitude h₁ = ' + H1 + ' km, satellite altitude h₂ = ' + H2 + ' km', 'Earth’s GM = 3.986 · 10¹⁴ m³/s²', 'A Hohmann transfer takes half the period of the ellipse'],
          question: 'How many minutes will the transfer take?',
          unit: 'min', answer: transferMin, tolerance: 0.02, points: 10,
          hint: 't = π · √(a³ / GM), where a = (r₁ + r₂) / 2 and r = R + h',
          formula: 'Kepler’s third law: T = 2π · √(a³ / GM). Transfer = T / 2 = π · √(a³ / GM)',
          solution: 'r₁ = 6,371 + ' + H1 + ' = ' + f0(r1 / 1000) + ' km, r₂ = 6,371 + ' + H2 + ' = ' + f0(r2 / 1000) + ' km, a = (' + f0(r1 / 1000) + ' + ' + f0(r2 / 1000) + ') / 2 = ' + f0(hoh.a / 1000) + ' km = ' + (hoh.a / 1e6).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' · 10⁶ m.<br>t = 3.14 · √((' + (hoh.a / 1e6).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' · 10⁶)³ / 3.986 · 10¹⁴) ≈ ' + f0(hoh.time) + ' s ≈ <b>' + f1(transferMin) + ' min</b>.',
          onWrong: { hours: missedWindowH, text: 'The engine would have fired at the wrong moment: the satellite would not have been at the meeting point, so Mission Control canceled the maneuver. ' + missedWindowText }
        },
        {
          id: 'fuel', type: 'numeric', title: 'Task: fuel consumption',
          text: ['The onboard computer has worked out the speed change needed for the two engine burns. All that is left is to find out how much fuel that takes.'],
          givens: ['Required speed change Δv = ' + DV + ' m/s (' + f0(hoh.dv1) + ' m/s at perigee + ' + f0(hoh.dv2) + ' m/s at apogee)', 'Ship mass m₀ = 12,000 kg', 'Engine exhaust velocity u = 3,000 m/s'],
          question: 'How many kilograms of fuel will the maneuver burn?',
          unit: 'kg', answer: burnFuel, tolerance: 0.03, points: 10,
          alsoAccept: [{ value: linearFuel, tolerance: 0.03, note: 'You used the approximate formula m ≈ m₀ · Δv / u. It works when Δv is much smaller than u, so your answer counts.' }],
          hint: 'm = m₀ · (1 − e<sup>−Δv/u</sup>)',
          formula: 'Tsiolkovsky rocket equation: m<sub>fuel</sub> = m₀ · (1 − e<sup>−Δv/u</sup>)',
          solution: 'Δv / u = ' + DV + ' / 3,000 ≈ ' + (DV / U).toLocaleString('en-US', { maximumFractionDigits: 4 }) + '; e<sup>−' + (DV / U).toLocaleString('en-US', { maximumFractionDigits: 4 }) + '</sup> ≈ ' + Math.exp(-DV / U).toLocaleString('en-US', { maximumFractionDigits: 4 }) + '; m = 12,000 · (1 − ' + Math.exp(-DV / U).toLocaleString('en-US', { maximumFractionDigits: 4 }) + ') ≈ <b>' + f0(burnFuel) + ' kg</b>.<br>If Δv is much smaller than u, there is a simpler way: m ≈ m₀ · Δv / u = ' + f0(linearFuel) + ' kg. This is slightly above the exact answer, but it counts too.',
          hours: transferH,
          effects: { fuel: -burnFuel, log: 'Hohmann transfer 300 → 800 km' },
          onWrong: { fuel: -Math.round(burnFuel * 0.1), text: 'Because of the inaccurate calculation, the computer made extra correction burns: another ' + f0(burnFuel * 0.1) + ' kg of fuel.' },
          ifFlag: {
            engineFault: { effects: { fuel: -Math.round(burnFuel * ENGINE_LOSS), safety: -10, log: 'Sticking valve stretched the transfer burns' }, feedback: 'The sticking main fuel valve stretched both burns: another ' + f0(burnFuel * ENGINE_LOSS) + ' kg of fuel gone.' }
          }
        },
        {
          id: 'emergency', type: 'shutdown', title: 'EMERGENCY: battery draining faster than planned',
          text: [
            'The ship has reached the satellite’s orbit, 5 km away from it. At that moment a micrometeorite damages a solar panel cable: the panel delivers almost no current, and the battery is draining much faster than planned.',
            'The flight engineer needs <b>' + EMERGENCY_H + ' hours</b> for the repair. Even after the repair the panel will deliver less current, so you must keep <b>at least 3 kWh</b> in the battery for the approach and the satellite repair.',
            'Decide what to switch off. The energy the systems left on will use: <b>E = P · t</b>.'
          ],
          hours: EMERGENCY_H, reserve: 3, points: 10,
          formula: 'E = P · t: energy (kWh) = total power of the systems left on (kW) × time (h)',
          consumers: [
            { name: 'Crew life support', power: 0.6, role: 'critical', offText: 'Without air, pressure and heat the crew will not survive 6 hours.' },
            { name: 'Navigation and attitude control', power: 0.3, role: 'needed', offSafety: -15, offText: 'The ship began to rotate slowly, making the panel hard to repair.' },
            { name: 'Satellite tracking radar', power: 0.25, role: 'needed', offSafety: -10, offText: 'Without radar the ship drifted blind 5 km from the satellite: a collision risk.' },
            { name: 'Link to Mission Control', power: 0.2, role: 'useful', offSafety: -5, offText: 'For 6 hours Mission Control did not know what was happening to the crew.' },
            { name: 'Science bay heating', power: 0.5, role: 'optional' },
            { name: 'Cabin lighting', power: 0.15, role: 'optional' },
            { name: 'Science experiments', power: 0.4, role: 'optional' }
          ]
        },
        {
          id: 'rendezvous', type: 'event', title: 'Approach',
          text: ['The panel is repaired, but it delivers only part of its current: enough for the ship’s systems, while the thrusters and radar run on the battery during the approach. The radar guides the ship to the satellite, and the attitude thrusters kill its speed. Sunkar is holding 50 meters from Zhuldyz-1.'],
          failText: 'The ship could not reach the satellite, and Mission Control brought the crew home.',
          hours: RDV_H, effects: { fuel: -APPROACH_FUEL, energy: -0.8, log: 'Approached to 50 m from the satellite' },
          ifFlag: {
            commsFault: { effects: { fuel: -COMMS_FUEL, energy: -COMMS_ENERGY, safety: -10, log: 'Link to Mission Control lost during the approach' }, feedback: 'The faulty amplifier gave out during the approach. Mission Control could not confirm the radar data, so the crew crept in on extra braking burns: another ' + COMMS_FUEL + ' kg of fuel and ' + f1(COMMS_ENERGY) + ' kWh.' }
          }
        },
        {
          id: 'contact', type: 'choice', title: 'Task: no contact with the satellite',
          question: 'The satellite does not respond to any signal. What do you do first?',
          points: 5,
          failText: 'The satellite cannot be repaired, and Mission Control brought the crew home.',
          explanation: 'The rule of space repairs: diagnostics first, spacewalk second. Every spacewalk uses oxygen and is dangerous, so astronauts only go out when they know what to fix.',
          options: [
            {
              text: 'Fly around the satellite, inspect it with cameras and radar, check the antenna and panels', correct: true,
              feedback: 'The inspection shows that the satellite’s antenna has turned away from the Earth and the onboard computer froze after a power surge.',
              hours: INSPECT_H, effects: { fuel: -INSPECT_FUEL, energy: -0.4, log: 'Satellite inspected: antenna turned away, computer frozen' }
            },
            {
              text: 'Send an astronaut outside to repair it right away', correct: false,
              feedback: 'The astronaut searched blindly for the fault for half an hour and came back empty-handed. The camera inspection had to be done anyway: the antenna has turned away, the computer is frozen.',
              hours: INSPECT_H, effects: { o2: -0.6, fuel: -INSPECT_FUEL, energy: -0.4, safety: -15, log: 'Spacewalk without diagnostics' },
              ifFlag: { suitLeak: { effects: { o2: -LEAK * 0.5, safety: -10 }, feedback: 'The suit valve was also venting oxygen: another ' + f2(LEAK * 0.5) + ' kg gone in half an hour.' } }
            },
            {
              text: 'Keep sending a reboot command at maximum transmitter power until it answers', correct: false,
              feedback: 'The satellite stays silent: its antenna is pointing the other way. The transmitter wasted 1.5 kWh, and another 0.4 kWh went on the inspection that had to be done anyway: the antenna has turned away, the computer is frozen.',
              hours: INSPECT_H, effects: { energy: -1.9, fuel: -INSPECT_FUEL, log: 'Full-power commands failed, then inspection' }
            },
            {
              text: 'Abort the mission and go home: it is too dangerous', correct: false,
              feedback: 'The crew is safe, but the satellite is still out of contact.',
              goto: 'return', effects: { flag: 'aborted', log: 'Mission aborted by the commander' }
            }
          ]
        },
        {
          id: 'repair', type: 'choice', title: 'Task: restore contact',
          question: 'The satellite’s antenna has turned away from the Earth and its computer is frozen. How do you restore contact?',
          points: 5,
          failText: 'The satellite repair was not finished, and Mission Control brought the crew home.',
          explanation: 'Contact has to work both ways: a working computer and an antenna pointed at the Earth. Working on a safety tether is slower, but safer than jerking the satellite around with a robotic arm.',
          options: [
            {
              text: 'Spacewalk on a safety tether: turn the antenna by hand and reboot the computer through the service port', correct: true,
              feedback: 'The antenna is pointing at the Earth and the computer has rebooted. Mission Control is receiving data from the satellite!',
              hours: REPAIR_H, effects: { o2: -EVA_O2, energy: -0.8, flag: 'restored', log: 'Contact with the satellite restored' },
              ifFlag: { suitLeak: { effects: { o2: -LEAK * 2, safety: -10 }, feedback: 'After 2 hours an alarm went off: a leak in the suit valve! The astronaut came back in and a second crew member finished the job. The leak cost ' + f2(LEAK * 2) + ' kg of oxygen.' } }
            },
            {
              text: 'Grab the satellite with the robotic arm and sharply turn the antenna', correct: false,
              feedback: 'The antenna is turned, the jolt rebooted the computer and contact is back. But the satellite’s solar panel is bent, the ship nearly collided with the satellite, and the thrusters burned 80 kg of fuel to stop the pair from spinning.',
              hours: 2, effects: { fuel: -80, energy: -0.5, safety: -15, flag: 'restored', log: 'Contact restored with the robotic arm, satellite panel damaged' }
            },
            {
              text: 'Go outside and only reboot the computer, leave the antenna alone', correct: false,
              feedback: 'The computer is working, but the antenna still points away from the Earth: the data is not getting through. Contact was not restored.',
              hours: 3, effects: { o2: -EVA_O2, energy: -0.6, log: 'Computer rebooted, antenna not turned' },
              ifFlag: { suitLeak: { effects: { o2: -LEAK * 3, safety: -10 }, feedback: 'On top of that, the suit valve was venting oxygen: another ' + f2(LEAK * 3) + ' kg gone in 3 hours.' } }
            },
            {
              text: 'Take the satellite into the cargo bay and bring it back to Earth', correct: false,
              feedback: 'With its panels deployed the satellite is more than 6 meters wide and does not fit in the bay. Time lost, contact not restored.',
              hours: 1, effects: { energy: -0.3, log: 'Attempted to bring the satellite on board' }
            }
          ]
        },
        {
          id: 'return', type: 'event', title: 'Return',
          text: ['A reverse Hohmann transfer: the engine takes the ship back down to the 300 km orbit, and from there the crew descends to Earth. Sunkar has landed.'],
          failText: 'There was not enough left for the trip home: Mission Control is making an emergency landing on backup systems. The crew was in great danger.',
          hours: returnH,
          effects: { fuel: -returnFuel, log: 'Landed on Earth' }
        }
      ]
    },

    // ---- Stubs for the next missions: the team fills in steps and removes locked ----
    {
      id: 'iss-docking', locked: true,
      title: 'Station Docking',
      subtitle: 'Catch up with a station in a 420 km orbit and dock within a limited time.',
      difficulty: 'Hard', steps: []
    },
    {
      id: 'moon-landing', locked: true,
      title: 'Moon Landing',
      subtitle: 'Work out the braking burn and land the module without using up all the fuel.',
      difficulty: 'Very hard', steps: []
    }
  ];

  // For debugging: mission 1 numbers in the browser console
  console.log('[Mission 1] Δv =', DV, 'm/s; transfer fuel =', burnFuel.toFixed(1), 'kg; transfer =', transferMin.toFixed(2), 'min; missed window =', missedWindowH.toFixed(2), 'h; return fuel =', returnFuel.toFixed(1), 'kg; return =', returnH.toFixed(2), 'h');
})();
