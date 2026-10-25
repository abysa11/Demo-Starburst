/*
 * Физика для Mission Simulator.
 * Все формулы школьного уровня (10 класс): закон всемирного тяготения,
 * круговая орбитальная скорость, третий закон Кеплера, формула Циолковского.
 * Единицы СИ: метры, секунды, килограммы.
 */
const Physics = {
  MU: 3.986e14,      // GM Земли, м³/с²
  R_EARTH: 6371e3,   // средний радиус Земли, м

  // Радиус орбиты по высоте над поверхностью (км -> м)
  radius(heightKm) {
    return this.R_EARTH + heightKm * 1000;
  },

  // Скорость на круговой орбите: v = √(GM / r)
  circularVelocity(r) {
    return Math.sqrt(this.MU / r);
  },

  // Период обращения по орбите с большой полуосью a: T = 2π·√(a³ / GM)
  period(a) {
    return 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / this.MU);
  },

  // Синодический период: через сколько времени два тела на разных орбитах снова
  // окажутся в том же положении друг относительно друга: 1/S = 1/T1 − 1/T2
  synodic(T1, T2) {
    return 1 / Math.abs(1 / T1 - 1 / T2);
  },

  // Скорость на эллиптической орбите в точке r (формула vis-viva, нужна только движку,
  // ученик получает готовое Δv): v = √(GM·(2/r − 1/a))
  visViva(r, a) {
    return Math.sqrt(this.MU * (2 / r - 1 / a));
  },

  // Гомановский переход между круговыми орбитами r1 и r2
  // Возвращает большую полуось a (м), импульсы dv1, dv2 и сумму dv (м/с), время перелёта (с)
  hohmann(r1, r2) {
    const a = (r1 + r2) / 2;
    const dv1 = Math.abs(this.visViva(r1, a) - this.circularVelocity(r1));
    const dv2 = Math.abs(this.circularVelocity(r2) - this.visViva(r2, a));
    return { a, dv1, dv2, dv: dv1 + dv2, time: this.period(a) / 2 };
  },

  // Формула Циолковского: масса топлива для манёвра Δv
  // m_топл = m0 · (1 − e^(−Δv / u)), u: скорость истечения газов
  fuelMass(m0, dv, u) {
    return m0 * (1 - Math.exp(-dv / u));
  }
};

window.Physics = Physics;
