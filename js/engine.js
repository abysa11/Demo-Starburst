/*
 * Mission Simulator engine. Reads window.MISSIONS (data/missions.js) and walks the player
 * through the mission steps. Adding a mission or task does not require changing the engine.
 */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const hud = document.getElementById('hud');

  const RES = {
    fuel: { label: 'Fuel', unit: 'kg', digits: 0, out: 'Out of fuel' },
    o2: { label: 'Oxygen', unit: 'kg', digits: 2, out: 'Out of oxygen' },
    energy: { label: 'Energy', unit: 'kWh', digits: 1, out: 'Battery depleted' }
  };
  const SCORED = ['numeric', 'choice', 'shutdown'];
  const EPS = 1e-9;
  const FAULTS_KEY = 'mission-simulator:faults';

  let M = null;   // current mission
  let S = null;   // game state
  let seenFaults = readSeenFaults();   // { 'mission/step': [names of systems already broken] }

  // ---------- utilities ----------
  const fmt = (x, d = 1) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtSmart = (x) => {
    const a = Math.abs(x);
    return fmt(x, a >= 100 ? 0 : a >= 10 ? 1 : 2);
  };
  const paras = (arr) => (arr || []).map((t) => `<p>${t}</p>`).join('');
  const el = (sel) => app.querySelector(sel);
  const clock = (h) => {
    const total = Math.round(h * 60);
    return `T+${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
  };
  // Accepts "5.04", "5,04", "1,047", "1 047", "5.", "−3", "5.04 kg"
  function parseNumber(str, unit) {
    let s = String(str).trim();
    if (unit && s.toLowerCase().endsWith(unit.toLowerCase())) s = s.slice(0, -unit.length);
    s = s.replace(/[a-z·/²³]+\.?$/i, '')
      .replace(/[\s  ]/g, '')
      .replace(/[−–]/g, '-')
      .replace(/,(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }
  // Shuffle a copy of the array (answer options appear in random order)
  function shuffled(arr) {
    const a = arr.map((x, i) => ({ x, i }));
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const order = (step, arr) => (step.shuffle === false ? arr.map((x, i) => ({ x, i })) : shuffled(arr));

  // ---------- faults ----------
  // The browser may block storage: then faults are remembered only until the page is closed
  function readSeenFaults() {
    try {
      return JSON.parse(localStorage.getItem(FAULTS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveSeenFaults() {
    try {
      localStorage.setItem(FAULTS_KEY, JSON.stringify(seenFaults));
    } catch (e) { /* see readSeenFaults */ }
  }
  // Pick the system that is broken on this run. Every fault comes up once before any
  // repeats, and a new round never starts with the fault the last one ended on.
  function pickFault(step) {
    const pool = step.systems.filter((s) => s.fault).map((s) => s.name);
    if (!pool.length) return null;
    const key = `${M.id}/${step.id}`;
    let seen = (seenFaults[key] || []).filter((n) => pool.includes(n));
    let left = pool.filter((n) => !seen.includes(n));
    if (!left.length) {
      left = pool.length > 1 ? pool.filter((n) => n !== seen[seen.length - 1]) : pool;
      seen = [];
    }
    const pick = left[Math.floor(Math.random() * left.length)];
    seenFaults[key] = [...seen, pick];
    saveSeenFaults();
    return pick;
  }

  // ---------- state ----------
  function startMission(id) {
    M = window.MISSIONS.find((m) => m.id === id);
    S = {
      res: { ...M.resources },
      start: { ...M.resources },
      time: 0, safety: 100, points: 0,
      maxPoints: M.steps.filter((s) => SCORED.includes(s.type)).reduce((a, s) => a + (s.points || 0), 0),
      flags: {}, log: [], tasks: [], failed: null, idx: -1, nextId: null
    };
    hud.hidden = false;
    renderHud();
    goTo(0);
  }

  function visible(step) {
    if (step.onlyIf && !S.flags[step.onlyIf]) return false;
    if (step.unless && S.flags[step.unless]) return false;
    return true;
  }

  function goTo(i) {
    while (i < M.steps.length && !visible(M.steps[i])) i++;
    if (i >= M.steps.length) return finish();
    S.idx = i;
    S.nextId = null;
    render(M.steps[i]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // For screen readers: move focus to the heading of the new step
    const h = app.querySelector('h2');
    if (h && !app.contains(document.activeElement)) h.focus({ preventScroll: true });
  }

  function next() {
    if (S.failed) return finish();
    if (S.nextId) {
      const j = M.steps.findIndex((s) => s.id === S.nextId);
      if (j >= 0) return goTo(j);
    }
    goTo(S.idx + 1);
  }

  // Apply effects: { fuel, o2, energy, safety, flag, log, hours }
  // Returns the resource changes to show to the player
  function apply(eff, extraHours) {
    eff = eff || {};
    const d = { fuel: 0, o2: 0, energy: 0, safety: 0 };
    const hours = (eff.hours || 0) + (extraHours || 0);
    const before = { ...S.res };
    if (hours > 0) {
      S.time += hours;
      const breath = (M.crew || 0) * (M.o2PerPersonHour || 0) * hours;
      S.res.o2 -= breath;
    }
    for (const k of Object.keys(RES)) {
      if (typeof eff[k] === 'number') S.res[k] += eff[k];
    }
    if (typeof eff.safety === 'number') {
      const prevSafety = S.safety;
      S.safety = Math.max(0, Math.min(100, S.safety + eff.safety));
      d.safety = S.safety - prevSafety;
    }
    if (eff.flag) S.flags[eff.flag] = true;
    if (eff.log) S.log.push({ t: S.time, text: eff.log });
    const step = M.steps[S.idx] || {};
    for (const k of Object.keys(RES)) {
      if (S.res[k] < -EPS && !S.failed) {
        S.failed = step.failText ? `${RES[k].out}. ${step.failText}` : `${RES[k].out} at stage "${step.title}".`;
        S.log.push({ t: S.time, text: `${RES[k].label}: supply exhausted` });
      }
      if (S.res[k] < 0) S.res[k] = 0;
      d[k] = S.res[k] - before[k];   // actual change (after clipping to zero)
    }
    d.hours = hours;
    renderHud(d);
    return d;
  }

  // Extra consequences of earlier decisions: src.ifFlag = { flag: { effects, feedback } }
  function applyFlags(src, d) {
    let html = '';
    for (const f of Object.keys(src.ifFlag || {})) {
      if (S.flags[f]) {
        d = mergeDeltas(d, apply(src.ifFlag[f].effects));
        html += src.ifFlag[f].feedback ? `<p class="fb warn">${src.ifFlag[f].feedback}</p>` : '';
      }
    }
    return { d, html };
  }

  function deltaChips(d) {
    if (!d) return '';
    const chips = [];
    for (const k of Object.keys(RES)) {
      if (Math.abs(d[k]) > 0.005) {
        chips.push(`<span class="chip ${d[k] < 0 ? 'neg' : 'pos'}">${RES[k].label} ${d[k] > 0 ? '+' : '−'}${fmtSmart(Math.abs(d[k]))} ${RES[k].unit}</span>`);
      }
    }
    if (d.safety) chips.push(`<span class="chip neg">Safety −${Math.round(Math.abs(d.safety))}%</span>`);
    if (d.hours) chips.push(`<span class="chip time">+${fmt(d.hours, 1)} h</span>`);
    return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
  }

  function failNote() {
    return S.failed ? `<div class="alert">${S.failed}</div>` : '';
  }

  // ---------- HUD ----------
  function renderHud(d) {
    if (!S) return;
    const meters = Object.keys(RES).map((k) => {
      const pct = Math.max(0, Math.min(100, (S.res[k] / S.start[k]) * 100));
      const low = pct < 15 ? ' low' : '';
      const flash = d && Math.abs(d[k]) > 0.005 ? ' flash' : '';
      return `<div class="meter${low}${flash}">
        <div class="meter-top"><span class="meter-label">${RES[k].label}</span></div>
        <div class="meter-val">${fmt(S.res[k], RES[k].digits)} <small>${RES[k].unit}</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
    hud.innerHTML = `<div class="hud-inner">
      <div class="hud-row"><span class="hud-title">${M.title}</span><span class="hud-time">${clock(S.time)}</span></div>
      <div class="meters">${meters}</div>
    </div>`;
  }

  // ---------- orbit diagram ----------
  // d = { type: 'hohmann', h1, h2, transfer: false }: transfer:false hides the transfer ellipse until the answer
  function diagram(d, forceTransfer) {
    if (!d || d.type !== 'hohmann') return '';
    const showTransfer = forceTransfer || d.transfer !== false;
    const cx = 150, cy = 112, E = 44, k = 0.07;
    const rp = E + d.h1 * k, ra = E + d.h2 * k;
    const a = (rp + ra) / 2, b = Math.sqrt(rp * ra);
    return `<figure class="diagram">
      <svg viewBox="0 0 300 224" role="img" aria-label="Diagram of the ship and satellite orbits">
        <defs><radialGradient id="earth" cx="40%" cy="35%"><stop offset="0" stop-color="#5fb3ff"/><stop offset="1" stop-color="#1b4f8a"/></radialGradient></defs>
        <circle cx="${cx}" cy="${cy}" r="${ra}" class="orb orb-sat"/>
        <circle cx="${cx}" cy="${cy}" r="${rp}" class="orb orb-ship"/>
        ${showTransfer ? `<path d="M ${cx - rp} ${cy} A ${a} ${b} 0 0 1 ${cx + ra} ${cy}" class="orb-transfer"/>` : ''}
        <circle cx="${cx}" cy="${cy}" r="${E}" fill="url(#earth)"/>
        <text x="${cx}" y="${cy + 4}" class="lbl lbl-earth" text-anchor="middle">Earth</text>
        <circle cx="${cx - rp}" cy="${cy}" r="5" class="dot-ship"/>
        <circle cx="${cx + ra}" cy="${cy}" r="5" class="dot-sat"/>
      </svg>
      <div class="legend">
        <span><i class="lg lg-ship"></i>Sunkar, ${d.h1} km orbit</span>
        <span><i class="lg lg-sat"></i>Zhuldyz-1, ${d.h2} km orbit</span>
        ${showTransfer ? '<span><i class="lg lg-tr"></i>transfer ellipse</span>' : ''}
      </div>
      <figcaption>Orbit altitudes are exaggerated so they can be seen.</figcaption>
    </figure>`;
  }

  // ---------- common step frame ----------
  function frame(step, body, textOverride) {
    const n = M.steps.length;
    const kind = { briefing: 'Briefing', check: 'Check', numeric: 'Calculation', choice: 'Decision', shutdown: 'Emergency', event: 'Flight' }[step.type] || '';
    app.innerHTML = `<section class="card step step-${step.type}">
      <div class="kicker"><span>Stage ${S.idx + 1} of ${n}</span><span class="tag tag-${step.type}">${kind}</span></div>
      <div class="progress"><i style="width:${((S.idx + 1) / n) * 100}%"></i></div>
      <h2 tabindex="-1">${step.title}</h2>
      ${diagram(step.diagram)}
      ${paras(textOverride || step.text)}
      ${body}
      <div class="result" id="result" aria-live="polite"></div>
      <div class="actions" id="actions"></div>
    </section>`;
  }

  function nextButton(label) {
    const a = el('#actions');
    a.innerHTML = `<button class="btn btn-primary" id="next">${label || (S.failed ? 'To results' : 'Next')}</button>`;
    el('#next').addEventListener('click', next);
    el('#next').focus({ preventScroll: true });
  }

  function render(step) {
    ({ briefing, check, numeric, choice, shutdown, event })[step.type](step);
  }

  // ---------- step types ----------
  function briefing(step) {
    frame(step, '');
    nextButton(step.button || 'Start');
  }

  function event(step) {
    const { d, html } = applyFlags(step, apply(step.effects, step.hours));
    // If a resource ran out on this step, skip the story text: the stage was not completed
    frame(step, '', S.failed ? ['Stage not completed.'] : null);
    el('#result').innerHTML = html + deltaChips(d) + failNote();
    nextButton();
  }

  function check(step) {
    const faulty = pickFault(step);
    const rows = step.systems.map((s, i) => `
      <li class="sys" data-i="${i}">
        <button class="sys-btn" data-i="${i}"><span class="sys-name">${s.name}</span><span class="badge">Check</span></button>
        <div class="sys-body"></div>
      </li>`).join('');
    frame(step, `<p class="counter" id="counter"></p><ul class="systems">${rows}</ul>`);
    const done = new Set();
    const counter = () => {
      el('#counter').textContent = `Systems checked: ${done.size} of ${step.systems.length}`;
      if (done.size === step.systems.length) {
        el('#actions').innerHTML = '<button class="btn btn-primary" id="next">All systems checked. Liftoff!</button>';
        el('#next').addEventListener('click', next);
      }
    };
    el('#actions').innerHTML = '<button class="btn btn-primary" disabled>Check all systems first</button>';
    counter();
    app.querySelectorAll('.sys-btn').forEach((btn) => btn.addEventListener('click', () => {
      const i = +btn.dataset.i, s = step.systems[i];
      const li = btn.parentElement, body = li.querySelector('.sys-body'), badge = btn.querySelector('.badge');
      if (li.classList.contains('checked') || li.classList.contains('checking')) return;
      li.classList.add('checking');
      badge.textContent = 'Diagnostics…';
      setTimeout(() => {
        li.classList.remove('checking');
        li.classList.add('checked');
        btn.disabled = true;
        if (s.name !== faulty) {
          li.classList.add('ok');
          badge.textContent = 'Nominal';
          body.innerHTML = `<p>${s.okText}</p>`;
          done.add(i);
          counter();
          return;
        }
        li.classList.add('fault');
        badge.textContent = 'Fault';
        body.innerHTML = `<p>${s.fault.faultText}</p><div class="opts">${order(step, s.fault.options).map(({ x, i: j }) => `<button class="opt" data-j="${j}">${x.text}</button>`).join('')}</div><div class="sys-res"></div>`;
        body.querySelectorAll('.opt').forEach((ob) => ob.addEventListener('click', () => {
          const o = s.fault.options[+ob.dataset.j];
          body.querySelectorAll('.opt').forEach((x) => { x.disabled = true; });
          ob.classList.add('chosen', o.correct ? 'right' : 'wrong');
          const d = apply(o.effects, o.hours);
          badge.textContent = o.correct ? 'Fixed' : 'Risk';
          li.classList.toggle('ok', !!o.correct);
          body.querySelector('.sys-res').innerHTML = `<p class="fb">${o.feedback || ''}</p>${deltaChips(d)}`;
          done.add(i);
          counter();
        }));
      }, 450);
    }));
  }

  function numeric(step) {
    const givens = step.givens ? `<div class="givens"><div class="label-sm">Given</div><ul>${step.givens.map((g) => `<li>${g}</li>`).join('')}</ul></div>` : '';
    frame(step, `${givens}
      <p class="q">${step.question}</p>
      <form class="answer" id="form" autocomplete="off">
        <input id="ans" type="text" inputmode="decimal" placeholder="Your answer" aria-label="Answer">
        <span class="unit">${step.unit || ''}</span>
      </form>
      <p class="err" id="err"></p>
      <div class="hint" id="hint" hidden></div>`);
    let hintUsed = false;
    el('#actions').innerHTML = `${step.hint ? '<button class="btn btn-ghost" id="hintBtn" type="button">Hint (−50% points)</button>' : ''}<button class="btn btn-primary" id="checkBtn" type="button">Check</button>`;
    if (step.hint) el('#hintBtn').addEventListener('click', () => {
      hintUsed = true;
      const h = el('#hint');
      h.hidden = false;
      h.innerHTML = `<span class="label-sm">Hint</span> ${step.hint}`;
      el('#hintBtn').remove();
    });
    const submit = (e) => {
      if (e) e.preventDefault();
      const raw = el('#ans').value;
      const v = parseNumber(raw, step.unit);
      if (!Number.isFinite(v)) { el('#err').textContent = 'Enter a number, for example 12.5'; return; }
      el('#err').textContent = '';
      el('#ans').disabled = true;
      const ans = step.answer;
      const tolAbs = typeof step.toleranceAbs === 'number' ? step.toleranceAbs : Math.abs(ans) * (step.tolerance ?? 0.05);
      let ok = Math.abs(v - ans) <= tolAbs + EPS;
      let altNote = '';
      if (!ok && step.alsoAccept) {
        const alt = step.alsoAccept.find((a) => Math.abs(v - a.value) <= Math.abs(a.value) * (a.tolerance ?? 0.03) + EPS);
        if (alt) { ok = true; altNote = alt.note || ''; }
      }
      const pts = ok ? (hintUsed ? step.points / 2 : step.points) : 0;
      S.points += pts;
      S.tasks.push({ id: step.id, title: step.title, ok, your: `${fmtSmart(v)} ${step.unit}`, correct: `${fmtSmart(ans)} ${step.unit}`, pts, max: step.points, hint: hintUsed });
      const tolText = typeof step.toleranceAbs === 'number' ? `±${fmtSmart(step.toleranceAbs)} ${step.unit}` : `±${Math.round((step.tolerance ?? 0.05) * 100)}%`;
      const d1 = apply(step.effects, step.hours);
      const extra = ok ? step.onCorrect : step.onWrong;
      const d2 = extra ? apply(extra) : null;
      const { d: sum, html: flagFb } = applyFlags(step, mergeDeltas(d1, d2));
      el('#result').innerHTML = `
        <div class="verdict ${ok ? 'right' : 'wrong'}">${ok ? 'Correct!' : 'Incorrect'} <span>+${fmt(pts, pts % 1 ? 1 : 0)} of ${step.points} points${hintUsed && ok ? ' (with hint)' : ''}</span></div>
        <p>Your answer: <b>${fmtSmart(v)} ${step.unit}</b>. Correct: <b>${fmtSmart(ans)} ${step.unit}</b> (accepted within ${tolText}).</p>
        ${altNote ? `<p class="fb">${altNote}</p>` : ''}
        <div class="formula"><span class="label-sm">Formula</span>${step.formula || ''}</div>
        ${step.solution ? `<div class="solution"><span class="label-sm">Solution</span>${step.solution}</div>` : ''}
        ${extra && extra.text ? `<p class="fb">${extra.text}</p>` : ''}
        ${flagFb}
        ${deltaChips(sum)}${failNote()}`;
      nextButton();
    };
    el('#form').addEventListener('submit', submit);
    el('#checkBtn').addEventListener('click', submit);
    // On a phone, do not open the keyboard automatically: the player reads the problem first
    if (window.matchMedia('(pointer: fine)').matches) el('#ans').focus({ preventScroll: true });
  }

  function mergeDeltas(a, b) {
    if (!b) return a;
    const out = {};
    for (const k of ['fuel', 'o2', 'energy', 'safety', 'hours']) out[k] = (a[k] || 0) + (b[k] || 0);
    return out;
  }

  function choice(step) {
    frame(step, `<p class="q">${step.question}</p><div class="opts">${order(step, step.options).map(({ x, i: j }) => `<button class="opt" data-j="${j}">${x.text}</button>`).join('')}</div>`);
    app.querySelectorAll('.opt').forEach((ob) => ob.addEventListener('click', () => {
      const o = step.options[+ob.dataset.j];
      app.querySelectorAll('.opt').forEach((x) => {
        x.disabled = true;
        if (step.options[+x.dataset.j].correct) x.classList.add('right');
      });
      ob.classList.add('chosen', o.correct ? 'right' : 'wrong');
      const pts = o.correct ? (step.points || 0) : 0;
      S.points += pts;
      if (step.points) S.tasks.push({ id: step.id, title: step.title, ok: !!o.correct, your: o.text, correct: (step.options.find((x) => x.correct) || {}).text, pts, max: step.points });
      const { d, html: extraFb } = applyFlags(o, apply(o.effects, o.hours));
      if (step.diagram && step.diagram.transfer === false) {
        const fig = app.querySelector('.diagram');
        if (fig) fig.outerHTML = diagram(step.diagram, true);
      }
      if (o.fail && !S.failed) S.failed = o.fail;
      if (o.goto) S.nextId = o.goto;
      el('#result').innerHTML = `
        ${step.points ? `<div class="verdict ${o.correct ? 'right' : 'wrong'}">${o.correct ? 'Good decision' : 'Not the best decision'} <span>+${pts} of ${step.points} points</span></div>` : ''}
        <p class="fb">${o.feedback || ''}</p>${extraFb}
        ${step.explanation ? `<div class="formula"><span class="label-sm">Why</span>${step.explanation}</div>` : ''}
        ${deltaChips(d)}${failNote()}`;
      nextButton();
    }));
  }

  function shutdown(step) {
    const E0 = S.res.energy;
    const budget = E0 - step.reserve;
    const rows = order(step, step.consumers).map(({ x: c, i }) => `
      <li class="cons role-${c.role}">
        <label>
          <input type="checkbox" checked data-i="${i}">
          <span class="switch" aria-hidden="true"></span>
          <span class="cons-name">${c.name}</span>
          <span class="cons-p">${fmt(c.power, 2)} kW</span>
        </label>
      </li>`).join('');
    frame(step, `
      <div class="energy-box">
        <div><span class="label-sm">Battery now</span><b>${fmt(E0, 1)} kWh</b></div>
        <div><span class="label-sm">Keep</span><b>${fmt(step.reserve, 1)} kWh</b></div>
        <div><span class="label-sm">Can spend in ${step.hours} h</span><b>${fmt(Math.max(0, budget), 1)} kWh</b></div>
      </div>
      <p class="q">Switch off the systems the ship can do without for ${step.hours} hours:</p>
      <ul class="consumers">${rows}</ul>
      <div class="live" id="live"></div>`);
    // boxes[i] matches step.consumers[i] (the on-screen order is shuffled)
    const boxes = [];
    app.querySelectorAll('.consumers input').forEach((b) => { boxes[+b.dataset.i] = b; });
    const calc = () => {
      const P = boxes.reduce((a, b, i) => a + (b.checked ? step.consumers[i].power : 0), 0);
      const E = P * step.hours;
      // The player works out energy E themselves: only the total power is shown
      el('#live').innerHTML = `
        <div class="live-row"><span>Switched on: P = <b>${fmt(P, 2)} kW</b></span><span>Enough? Work out E = P · t</span></div>`;
      return { P, E };
    };
    boxes.forEach((b) => b.addEventListener('change', calc));
    calc();
    el('#actions').innerHTML = '<button class="btn btn-primary" id="confirm">Confirm decision</button>';
    el('#confirm').addEventListener('click', () => {
      const { P, E } = calc();
      boxes.forEach((b) => { b.disabled = true; });
      const off = step.consumers.filter((c, i) => !boxes[i].checked);
      const notes = [];
      let safety = 0, blocked = false;
      const crit = off.filter((c) => c.role === 'critical');
      const offName = off.length ? 'Switched off: ' + off.map((c) => c.name.toLowerCase()).join(', ') : 'Nothing switched off';
      const correctText = 'Switch off the non-essential systems, keep life support, navigation and radar, stay within the reserve';
      if (crit.length) {
        // A critical system must not be switched off: Mission Control aborts the mission at once
        S.failed = `${crit.map((c) => c.name).join(', ')}: switched off. The crew is in danger, Mission Control urgently aborted the mission.`;
        S.tasks.push({ id: step.id, title: 'Task: what to switch off in a power shortage', ok: false, your: offName, correct: correctText, pts: 0, max: step.points });
        const dc = apply({ safety: -100, log: 'Life support switched off, Mission Control aborted the mission' });
        el('#result').innerHTML = `
          <div class="verdict wrong">You can’t do that <span>+0 of ${step.points} points</span></div>
          ${crit.map((c) => `<p class="fb warn"><b>${c.name}.</b> ${c.offText || ''}</p>`).join('')}
          <div class="formula"><span class="label-sm">Formula</span>${step.formula}</div>
          ${deltaChips(dc)}${failNote()}`;
        return nextButton();
      }
      for (const c of off) {
        if (c.offSafety) { safety += c.offSafety; notes.push(`<b>${c.name}.</b> ${c.offText || ''}`); if (c.role === 'needed') blocked = true; }
      }
      const withinBudget = E <= budget + EPS;
      const killsBattery = E > E0 + EPS;
      if (!withinBudget && !killsBattery) { safety -= 10; notes.push('<b>Reserve breached.</b> Almost no energy is left for the approach and the satellite repair.'); }
      if (killsBattery) safety -= 20;
      if (killsBattery) notes.push(`<b>Battery depleted.</b> The systems needed ${fmt(E, 1)} kWh, but the battery only held ${fmt(E0, 1)} kWh.`);
      const ok = !blocked && withinBudget;
      const pts = ok ? step.points : 0;
      S.points += pts;
      S.tasks.push({ id: step.id, title: 'Task: what to switch off in a power shortage', ok, your: offName, correct: correctText, pts, max: step.points });
      const d = apply({ energy: -E, safety: safety || undefined, log: `Power emergency: P = ${fmt(P, 2)} kW, used ${fmt(Math.min(E, E0), 1)} kWh` }, step.hours);
      el('#result').innerHTML = `
        <div class="verdict ${ok ? 'right' : 'wrong'}">${ok ? 'The ship held out!' : 'A decision with consequences'} <span>+${pts} of ${step.points} points</span></div>
        <p>Over ${step.hours} h the systems left on use E = ${fmt(P, 2)} kW · ${step.hours} h = <b>${fmt(E, 2)} kWh</b>. You could spend ${fmt(Math.max(0, budget), 2)} kWh. Left in the battery: <b>${fmt(S.res.energy, 2)} kWh</b>.</p>
        ${notes.map((n) => `<p class="fb warn">${n}</p>`).join('')}
        <div class="formula"><span class="label-sm">Formula</span>${step.formula}</div>
        ${deltaChips(d)}${failNote()}`;
      nextButton();
    });
  }

  // ---------- results ----------
  function finish() {
    const success = !S.failed && !!S.flags[M.success.flag];
    const reason = S.failed || (S.flags.aborted ? 'The mission was aborted by the commander.' : 'Contact with the satellite was not restored.');
    // Each part is rounded; the total is the sum of the rounded parts (so the numbers add up)
    const taskScore = Math.round(S.maxPoints ? (40 * S.points) / S.maxPoints : 0);
    const safetyScore = Math.round((30 * S.safety) / 100);
    const resScore = Math.round(Object.keys(RES).reduce((a, k) => a + (success ? 10 * Math.min(1, S.res[k] / M.targets[k]) : 0), 0));
    const total = taskScore + safetyScore + resScore;
    // The top rank requires no risky decisions
    const rank = !success ? 'Try again'
      : total >= 90 && S.safety >= 90 ? 'Elite Commander'
      : total >= 90 ? 'Experienced Commander (some risky decisions)'
      : total >= 75 ? 'Experienced Commander'
      : total >= 60 ? 'Commander in Training' : 'More training needed';
    console.log('[Result] resources left:', JSON.stringify(S.res), 'points:', S.points, '/', S.maxPoints, 'safety:', S.safety);
    const bar = (label, v, max, note) => `<div class="score-row"><div class="score-top"><span>${label}</span><b>${fmt(v, 0)} / ${max}</b></div><div class="bar"><i style="width:${(v / max) * 100}%"></i></div>${note ? `<div class="score-note">${note}</div>` : ''}</div>`;
    const resRows = Object.keys(RES).map((k) => `<tr><td>${RES[k].label}</td><td>${fmt(S.res[k], RES[k].digits)} ${RES[k].unit}</td><td>of ${fmt(S.start[k], RES[k].digits)}</td></tr>`).join('');
    const done = new Set(S.tasks.map((t) => t.id));
    const skipped = M.steps.filter((st) => SCORED.includes(st.type) && st.points && !done.has(st.id))
      .map((st) => `<li class="no skip"><div class="t-title"><span>– ${st.title.replace('Task: ', '')}</span><b>0/${st.points}</b></div><div class="t-ans">Not reached: the mission ended early</div></li>`).join('');
    const taskRows = S.tasks.map((t) => `<li class="${t.ok ? 'ok' : 'no'}"><div class="t-title"><span>${t.ok ? '✓' : '✗'} ${t.title.replace('Task: ', '')}</span><b>${fmt(t.pts, t.pts % 1 ? 1 : 0)}/${t.max}</b></div><div class="t-ans">Your answer: ${t.your}${t.ok ? '' : `<br>Better: ${t.correct}`}</div></li>`).join('');
    const logRows = S.log.map((l) => `<li><span class="lt">${clock(l.t)}</span> ${l.text}</li>`).join('');
    app.innerHTML = `<section class="card score">
      <div class="verdict-big ${success ? 'right' : 'wrong'}">${success ? 'Mission accomplished' : 'Mission failed'}</div>
      ${success ? '' : `<p class="reason">${reason}</p>`}
      <div class="total"><span class="total-num">${total}</span><span class="total-of">/ 100</span></div>
      <div class="rank">${rank}</div>
      ${bar('Tasks solved correctly', taskScore, 40, `${fmt(S.points, S.points % 1 ? 1 : 0)} of ${S.maxPoints} task points`)}
      ${bar('Safety of decisions', safetyScore, 30, `Safety level: ${S.safety}%`)}
      ${bar('Resources left', resScore, 30, success ? 'The more fuel, oxygen and energy left, the better' : 'Resource points are only given for a completed mission')}
      <h3>Resources after the flight</h3>
      <table class="res-table">${resRows}<tr><td>Flight time</td><td colspan="2">${clock(S.time).replace('T+', '')}</td></tr></table>
      <h3>Tasks</h3>
      <ul class="tasks">${taskRows}${skipped}</ul>
      <h3>Flight log</h3>
      <ul class="log">${logRows}</ul>
      <div class="actions">
        <button class="btn btn-primary" id="again">Play again</button>
        <button class="btn btn-ghost" id="menu">Back to missions</button>
      </div>
    </section>`;
    el('#again').addEventListener('click', () => startMission(M.id));
    el('#menu').addEventListener('click', showMenu);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- menu ----------
  function showMenu() {
    S = null; M = null;
    hud.hidden = true;
    const cards = window.MISSIONS.map((m) => `
      <button class="mission ${m.locked ? 'locked' : ''}" data-id="${m.id}" ${m.locked ? 'disabled' : ''}>
        <div class="mission-top"><span class="tag">${m.locked ? 'Coming soon' : 'Available'}</span><span class="diff">${m.difficulty || ''}</span></div>
        <div class="mission-title">${m.title}</div>
        <div class="mission-sub">${m.subtitle || ''}</div>
      </button>`).join('');
    app.innerHTML = `<section class="hero">
        <div class="logo" aria-hidden="true"></div>
        <h1>Mission Simulator</h1>
        <p class="lead">Become the commander of a spacecraft: choose a mission, check your resources and equipment, solve physics and astronomy tasks, and make decisions in an emergency. At the end of the flight, Mission Control will assess your work.</p>
      </section>
      <h2 class="section-title">Choose a mission</h2>
      <div class="missions">${cards}</div>
      <p class="footnote">You will need a calculator (a phone calculator is fine).</p>`;
    app.querySelectorAll('.mission:not(.locked)').forEach((b) => b.addEventListener('click', () => startMission(b.dataset.id)));
    window.scrollTo({ top: 0 });
  }

  showMenu();
})();
