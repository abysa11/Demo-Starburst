/*
 * Physics for Mission Simulator.
 * All formulas are high-school level (grade 10): the law of universal gravitation,
 * circular orbital velocity, Kepler's third law, the Tsiolkovsky rocket equation.
 * SI units: meters, seconds, kilograms.
 */
const Physics = {
  MU: 3.986e14,      // Earth's GM, m³/s²
  R_EARTH: 6371e3,   // mean Earth radius, m

  // Orbit radius from altitude above the surface (km -> m)
  radius(heightKm) {
    return this.R_EARTH + heightKm * 1000;
  },

  // Velocity in a circular orbit: v = √(GM / r)
  circularVelocity(r) {
    return Math.sqrt(this.MU / r);
  },

  // Orbital period for semi-major axis a: T = 2π·√(a³ / GM)
  period(a) {
    return 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / this.MU);
  },

  // Synodic period: how long until two bodies in different orbits are back in the
  // same position relative to each other: 1/S = 1/T1 − 1/T2
  synodic(T1, T2) {
    return 1 / Math.abs(1 / T1 - 1 / T2);
  },

  // Velocity on an elliptical orbit at point r (vis-viva equation, used only by the engine,
  // the student is given Δv ready-made): v = √(GM·(2/r − 1/a))
  visViva(r, a) {
    return Math.sqrt(this.MU * (2 / r - 1 / a));
  },

  // Hohmann transfer between circular orbits r1 and r2
  // Returns semi-major axis a (m), impulses dv1, dv2 and their sum dv (m/s), transfer time (s)
  hohmann(r1, r2) {
    const a = (r1 + r2) / 2;
    const dv1 = Math.abs(this.visViva(r1, a) - this.circularVelocity(r1));
    const dv2 = Math.abs(this.circularVelocity(r2) - this.visViva(r2, a));
    return { a, dv1, dv2, dv: dv1 + dv2, time: this.period(a) / 2 };
  },

  // Tsiolkovsky rocket equation: fuel mass for a maneuver Δv
  // m_fuel = m0 · (1 − e^(−Δv / u)), u: exhaust velocity
  fuelMass(m0, dv, u) {
    return m0 * (1 - Math.exp(-dv / u));
  }
};

window.Physics = Physics;
