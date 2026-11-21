/* =====================================================================
   eMAR Safety Simulator — app logic
   Sections:
     1. State & storage      4. Rendering
     2. Clock & time helpers 5. Administration flow (alerts → document)
     3. Safety checks        6. Modals & misc
   Drugs, interactions and patients are defined in mar-data.js.
   ===================================================================== */

/* ===================== 1. STATE & STORAGE ===================== */
const STORE_KEY = 'emar-demo-v1';
const ALLERGY_REVIEW_VALID_HRS = 12;   // one shift

let state = loadState();
let currentPatientId = state.currentPatientId || PATIENTS[0].id;

function defaultState() {
  return { admins: [], log: [], labs: {}, reviewed: {}, simOffsetMs: null, nurse: '', currentPatientId: null };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {}
  return defaultState();
}
function saveState() {
  state.currentPatientId = currentPatientId;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
function uid() { return Math.random().toString(36).slice(2, 10); }

function patient(id = currentPatientId) { return PATIENTS.find(p => p.id === id); }
function labsOf(p) { return Object.assign({}, p.labs, state.labs[p.id] || {}); }
function drugOf(order) { return DRUGS[order.drug]; }
function adminsFor(pid) { return state.admins.filter(a => a.patientId === pid); }

/* ===================== 2. CLOCK & TIME HELPERS ===================== */
function now() { return new Date(Date.now() + (state.simOffsetMs || 0)); }
function dayKey(d = now()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pad(n) { return String(n).padStart(2, '0'); }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function slotDate(slot, dk = dayKey()) {
  const [y, m, d] = dk.split('-').map(Number);
  const [h, mi] = slot.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}
function minutesBetween(a, b) { return Math.round((b - a) / 60000); }
function fmtDuration(mins) {
  mins = Math.abs(mins);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
function windowMins(order) { return drugOf(order).timeCritical ? 30 : 60; }
function ageOf(dob) {
  const b = new Date(dob), n = now();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

/* Minimum hours between two doses of the same order */
function minSpacingHrs(order) {
  if (order.prn) return order.minIntervalHrs || 4;
  const t = order.times.map(s => slotDate(s).getHours() + slotDate(s).getMinutes() / 60).sort((a, b) => a - b);
  if (t.length === 1) return 12;
  let gap = 24;
  for (let i = 0; i < t.length; i++) {
    const next = i + 1 < t.length ? t[i + 1] : t[0] + 24;
    gap = Math.min(gap, next - t[i]);
  }
  return gap / 2;
}

/* Status of one scheduled slot today: upcoming | due | late | given | held */
function slotStatus(p, order, slot) {
  const rec = state.admins.find(a => a.patientId === p.id && a.orderId === order.id && a.dateKey === dayKey() && a.slot === slot);
  if (rec) return { status: rec.status, rec };
  const diff = minutesBetween(slotDate(slot), now()); // + = past due
  const w = windowMins(order);
  if (diff < -w) return { status: 'upcoming' };
  if (diff <= w) return { status: 'due' };
  return { status: 'late', lateBy: diff };
}

/* ===================== 3. SAFETY CHECKS =====================
   Each check returns alerts: { severity: 'stop'|'warn'|'info', type, title, msg }
*/
function runSafetyChecks(p, order, slot) {
  const drug = drugOf(order);
  const alerts = [];
  alerts.push(...checkAllergies(p, drug));
  alerts.push(...checkTiming(p, order, slot));
  alerts.push(...checkLabs(p, drug));
  alerts.push(...checkInteractions(p, order, slot));
  const rank = { stop: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function checkAllergies(p, drug) {
  const out = [];
  for (const al of p.allergies) {
    const g = al.group.toLowerCase();
    const direct = (drug.allergyGroups || []).includes(g) || drug.classes.includes(g) || drug.name.toLowerCase().includes(g);
    if (direct) {
      out.push({ severity: 'stop', type: 'Allergy', title: `Patient is allergic to ${al.substance}`,
        msg: `${drug.name} belongs to the ${al.substance} group. Documented reaction: ${al.reaction} (${al.severity}). Do not give. Contact the provider for an alternative.` });
    } else if ((drug.crossGroups || []).includes(g)) {
      out.push({ severity: 'warn', type: 'Allergy cross-sensitivity', title: `Possible cross-reaction with ${al.substance} allergy`,
        msg: `${drug.name} can cross-react with ${al.substance} (documented reaction: ${al.reaction}). Confirm with the provider/pharmacist and monitor closely for a reaction.` });
    }
  }
  return out;
}

function checkTiming(p, order, slot) {
  const out = [];
  const n = now();
  const mine = adminsFor(p.id).filter(a => a.orderId === order.id && a.status === 'given');

  // Too soon after the last dose of this same order
  const last = mine.sort((a, b) => new Date(b.givenAt) - new Date(a.givenAt))[0];
  if (last) {
    const since = minutesBetween(new Date(last.givenAt), n);
    const min = minSpacingHrs(order) * 60;
    if (since >= 0 && since < min) {
      out.push({ severity: order.prn ? 'stop' : 'warn', type: 'Dose too soon',
        title: `Last dose was only ${fmtDuration(since)} ago`,
        msg: `${drugOf(order).name} was last given at ${hhmm(new Date(last.givenAt))}. ` +
             (order.prn ? `This PRN order allows a dose every ${order.minIntervalHrs} h at most. The next dose is allowed at ${hhmm(new Date(new Date(last.givenAt).getTime() + min * 60000))}.`
                        : `Doses should be at least ${minSpacingHrs(order)} h apart. Risk of a double dose.`) });
    }
  }

  // Max total in 24 h
  if (order.maxPer24h) {
    const total = mine.filter(a => minutesBetween(new Date(a.givenAt), n) <= 1440).reduce((s, a) => s + Number(a.dose), 0);
    if (total + order.dose > order.maxPer24h) {
      out.push({ severity: 'stop', type: 'Maximum daily dose', title: `24-hour maximum would be exceeded`,
        msg: `${total} ${order.unit} already given in the last 24 h. Another ${order.dose} ${order.unit} brings the total to ${total + order.dose} ${order.unit} (max ${order.maxPer24h} ${order.unit}).` });
    }
  }

  if (!slot) return out;

  // Early / late vs the scheduled time
  const diff = minutesBetween(slotDate(slot), n);
  const w = windowMins(order);
  if (diff < -w) {
    out.push({ severity: 'warn', type: 'Early dose', title: `${fmtDuration(diff)} EARLY (scheduled ${slot})`,
      msg: `Allowed window is ±${w} min${drugOf(order).timeCritical ? ' (time-critical medication)' : ''}. Giving early can shorten the interval from the previous dose and cause higher drug levels.` });
  } else if (diff > w) {
    out.push({ severity: 'warn', type: 'Late dose', title: `${fmtDuration(diff)} LATE (scheduled ${slot})`,
      msg: `Allowed window is ±${w} min${drugOf(order).timeCritical ? ' (time-critical medication)' : ''}. Late doses can lower therapeutic levels. Consider whether the next dose needs to be adjusted and notify the provider if required.` });
  }

  // An earlier slot today was never documented
  const earlier = order.times.filter(t => slotDate(t) < slotDate(slot));
  for (const t of earlier) {
    const st = slotStatus(p, order, t);
    if (st.status !== 'given' && st.status !== 'held') {
      out.push({ severity: 'warn', type: 'Undocumented prior dose', title: `The ${t} dose was never documented`,
        msg: `Check whether the ${t} dose was given but not charted before giving this one, to avoid a double dose.` });
    }
  }
  return out;
}

function checkLabs(p, drug) {
  const labs = labsOf(p);
  const out = [];
  for (const c of drug.checks || []) {
    const v = labs[c.key];
    if (v === null || v === undefined || v === '') continue;
    const hit = c.op === '<' ? Number(v) < c.value : Number(v) > c.value;
    if (hit) {
      const info = LAB_INFO[c.key];
      out.push({ severity: c.severity, type: 'Lab / vital sign',
        title: `${info.label} ${v} ${info.unit} (${c.op === '<' ? 'below' : 'above'} ${c.value})`, msg: c.msg });
    }
  }
  return out;
}

function matchesSpec(drugKey, spec) {
  if (spec.startsWith('class:')) return DRUGS[drugKey].classes.includes(spec.slice(6));
  return drugKey === spec;
}

function checkInteractions(p, order, slot) {
  const n = now();
  const out = [];
  const seen = new Set();

  // "Other" meds: given recently, or scheduled & due in the current window
  const others = [];
  for (const a of adminsFor(p.id)) {
    if (a.status !== 'given' || a.orderId === order.id) continue;
    const o = p.orders.find(x => x.id === a.orderId);
    others.push({ order: o, when: new Date(a.givenAt), kind: 'given' });
  }
  for (const o of p.orders) {
    if (o.id === order.id || o.prn) continue;
    for (const t of o.times) {
      const st = slotStatus(p, o, t);
      if (st.status === 'due' || st.status === 'late' && st.lateBy <= 120) others.push({ order: o, when: slotDate(t), kind: 'due' });
    }
  }

  for (const rule of INTERACTIONS) {
    const lookback = (rule.lookbackHrs || INTERACTION_LOOKBACK_HRS) * 60;
    for (const [mine, theirs] of [[rule.a, rule.b], [rule.b, rule.a]]) {
      if (!matchesSpec(order.drug, mine)) continue;
      for (const o of others) {
        if (!matchesSpec(o.order.drug, theirs)) continue;
        if (o.kind === 'given' && minutesBetween(o.when, n) > lookback) continue;
        const key = rule.msg + o.order.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const otherName = drugOf(o.order).name;
        out.push({ severity: rule.severity, type: 'Drug interaction',
          title: `${drugOf(order).name} + ${otherName}`,
          msg: `${otherName} ${o.kind === 'given' ? `was given at ${hhmm(o.when)}` : `is also due now (${hhmm(o.when)})`}. ${rule.msg}` });
      }
    }
  }
  return out;
}

function allergyReviewed(p) {
  const t = state.reviewed[p.id];
  return t && minutesBetween(new Date(t), now()) >= 0 && minutesBetween(new Date(t), now()) < ALLERGY_REVIEW_VALID_HRS * 60;
}

/* ===================== 4. RENDERING ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const p = patient();
  renderClock();
  renderTabs();
  renderPatient(p);
  renderLabs(p);
  renderMar(p);
  renderLog();
}

function renderClock() {
  const n = now();
  $('clockTime').textContent = hhmm(n);
  const sim = !!state.simOffsetMs;
  $('clockTag').textContent = sim ? 'Simulated' : 'Live';
  $('clockTag').classList.toggle('sim', sim);
  if (document.activeElement !== $('clockSet')) $('clockSet').value = hhmm(n);
}

function renderTabs() {
  $('tabs').innerHTML = PATIENTS.map(p => `
    <button class="tab" role="tab" aria-selected="${p.id === currentPatientId}" data-pid="${p.id}">
      <b>${esc(p.name)}</b><small>Rm ${esc(p.room)} · MRN ${esc(p.mrn)}</small>
    </button>`).join('');
}

function renderPatient(p) {
  const reviewed = allergyReviewed(p);
  const allergyText = p.allergies.length
    ? p.allergies.map(a => `${esc(a.substance)} <span style="font-weight:400">(${esc(a.reaction)})</span>`).join(' · ')
    : 'No known drug allergies (NKDA)';
  $('ptPanel').innerHTML = `
    <div class="pt-name">${esc(p.name)}</div>
    <div class="pt-meta">
      <span><b>${ageOf(p.dob)} y</b> ${esc(p.sex)}</span>
      <span>DOB <b>${esc(p.dob)}</b></span>
      <span>MRN <b>${esc(p.mrn)}</b></span>
      <span>Room <b>${esc(p.room)}</b></span>
      <span>Wt <b>${esc(p.weightKg)} kg</b></span>
      <span>Provider <b>${esc(p.provider)}</b></span>
    </div>
    <div class="pt-dx"><span style="color:var(--muted)">Dx:</span> ${esc(p.diagnosis)}</div>
    <div class="allergy-box ${p.allergies.length ? '' : 'nkda'}">
      <div class="allergy-head">
        <span class="allergy-title" ${p.allergies.length ? '' : 'style="color:var(--ok)"'}>⚠ Allergies</span>
        <span class="reviewed ${reviewed ? 'yes' : 'no'}">${reviewed ? '✓ Reviewed ' + hhmm(new Date(state.reviewed[p.id])) : 'Not reviewed this shift'}</span>
        <button class="btn sm" id="reviewAllergyBtn">Review allergies</button>
      </div>
      <div class="allergy-list">${allergyText}</div>
    </div>`;
  $('reviewAllergyBtn').onclick = () => showAllergyReview(p);
}

function labClass(key, v) {
  const i = LAB_INFO[key];
  if (v === null || v === undefined || v === '') return '';
  if (i.lo !== null && Number(v) < i.lo) return 'low';
  if (i.hi !== null && Number(v) > i.hi) return 'high';
  return '';
}

function renderLabs(p) {
  const labs = labsOf(p);
  $('labPanel').innerHTML = `
    <div class="labs-head"><h3>Latest labs &amp; vitals</h3><button class="btn sm" id="editLabsBtn">Update</button></div>
    <div class="labs">
      ${Object.keys(LAB_INFO).map(k => `
        <div class="lab ${labClass(k, labs[k])}" title="Normal: ${esc(LAB_INFO[k].normal)}">
          <small>${esc(LAB_INFO[k].label)}</small>
          <b>${labs[k] ?? '—'}</b><i>${esc(LAB_INFO[k].unit)}</i>
        </div>`).join('')}
    </div>`;
  $('editLabsBtn').onclick = () => showLabEditor(p);
}

function medInfoHTML(p, o) {
  const d = drugOf(o);
  const allergic = checkAllergies(p, d).some(a => a.severity === 'stop');
  return `
    <div>
      <div class="med-name">${esc(d.name)}</div>
      <div class="med-sig">${o.dose} ${esc(o.unit)} · ${esc(o.route)} · ${esc(o.freq)}</div>
      ${o.note ? `<div class="med-note">${esc(o.note)}</div>` : ''}
      <div class="med-flags">
        ${allergic ? '<span class="flag allergy">Allergy</span>' : ''}
        ${d.timeCritical ? '<span class="flag tc">Time-critical</span>' : ''}
        ${d.rapidInsulin ? '<span class="flag insulin">Rapid insulin</span>' : ''}
      </div>
    </div>`;
}

function lastGivenHTML(p, o) {
  const last = adminsFor(p.id).filter(a => a.orderId === o.id && a.status === 'given')
    .sort((a, b) => new Date(b.givenAt) - new Date(a.givenAt))[0];
  if (!last) return '<div class="last">Not given yet</div>';
  const ago = minutesBetween(new Date(last.givenAt), now());
  return `<div class="last">Last: <b>${hhmm(new Date(last.givenAt))}</b> by ${esc(last.nurse)}<br>${ago >= 0 ? fmtDuration(ago) + ' ago' : ''}</div>`;
}

function renderMar(p) {
  const head = `<div class="mar-row head"><div>Medication</div><div>Today's schedule</div><div>Last given</div></div>`;
  const sched = p.orders.filter(o => !o.prn);
  const prn = p.orders.filter(o => o.prn);

  $('marScheduled').innerHTML = head + sched.map(o => `
    <div class="mar-row">
      ${medInfoHTML(p, o)}
      <div class="chips">
        ${o.times.map(t => {
          const st = slotStatus(p, o, t);
          const label = { upcoming: 'Upcoming', due: 'Due now', late: 'Late ' + fmtDuration(st.lateBy || 0),
            given: st.rec ? '✓ ' + hhmm(new Date(st.rec.givenAt)) + ' ' + st.rec.nurse : '', held: 'Held' }[st.status];
          return `<button class="chip ${st.status}" data-order="${o.id}" data-slot="${t}"><b>${t}</b><small>${esc(label)}</small></button>`;
        }).join('')}
      </div>
      ${lastGivenHTML(p, o)}
    </div>`).join('');

  $('marPrn').innerHTML = head.replace("Today's schedule", 'Action') + prn.map(o => {
    const todays = adminsFor(p.id).filter(a => a.orderId === o.id && a.dateKey === dayKey());
    return `
    <div class="mar-row">
      ${medInfoHTML(p, o)}
      <div class="chips">
        <button class="btn sm primary" data-order="${o.id}" data-prn="1">Give PRN dose</button>
        ${todays.map(a => `<button class="chip ${a.status}" data-rec="${a.id}"><b>${hhmm(new Date(a.givenAt))}</b><small>${a.status === 'given' ? '✓ ' + esc(a.nurse) : 'Held'}</small></button>`).join('')}
      </div>
      ${lastGivenHTML(p, o)}
    </div>`;
  }).join('');
}

function renderLog() {
  if (!state.log.length) {
    $('alertLog').innerHTML = '<div class="empty">No alerts yet. Every safety alert, override, and cancelled dose will be recorded here.</div>';
    return;
  }
  const outcomeClass = { Given: 'ok', 'Given (override)': 'warn', Cancelled: 'info', Held: 'warn', Blocked: 'stop', Removed: 'info' };
  $('alertLog').innerHTML = `<table>
    <thead><tr><th>Time</th><th>Patient</th><th>Medication</th><th>Alerts</th><th>Outcome</th><th>Reason / Nurse</th></tr></thead>
    <tbody>${state.log.slice().reverse().map(l => `
      <tr>
        <td>${esc(l.time)}</td>
        <td>${esc(l.patient)}</td>
        <td>${esc(l.med)}</td>
        <td>${l.alerts.map(a => `<div><span class="pill ${a.severity}">${esc(a.type)}</span> ${esc(a.title)}</div>`).join('') || '—'}</td>
        <td><span class="pill ${outcomeClass[l.outcome] || 'info'}">${esc(l.outcome)}</span></td>
        <td>${esc(l.reason || '')}${l.verifier ? `<br><small>2nd RN: ${esc(l.verifier)}</small>` : ''}<br><small>${esc(l.nurse || '')}</small></td>
      </tr>`).join('')}</tbody></table>`;
}

function logEvent(p, order, alerts, outcome, reason, verifier) {
  state.log.push({ time: hhmm(now()), patient: p.name, med: order ? drugOf(order).name : '—',
    alerts: alerts.map(a => ({ severity: a.severity, type: a.type, title: a.title })),
    outcome, reason, verifier, nurse: state.nurse });
  saveState();
}

/* ===================== 5. ADMINISTRATION FLOW ===================== */
async function startAdministration(p, order, slot) {
  const drug = drugOf(order);

  // 0. Already documented?
  if (slot) {
    const st = slotStatus(p, order, slot);
    if (st.status === 'given') return showRecord(p, st.rec);
    if (st.status === 'held') {
      const r = await modal({ tone: 'info', icon: 'ℹ', title: `${slot} dose was held`,
        body: `<p>This dose was documented as <b>held</b> at ${hhmm(new Date(st.rec.givenAt))}. Reason: ${esc(st.rec.comment || '—')}.</p>`,
        buttons: [{ label: 'Close', value: 'close' }, { label: 'Give it now instead', value: 'give', kind: 'primary' }] });
      if (r.value !== 'give') return;
      state.admins = state.admins.filter(a => a.id !== st.rec.id);
    }
  }

  // 1. Nurse identified?
  if (!state.nurse) {
    const r = await modal({ tone: 'info', icon: '👤', title: 'Enter your initials',
      body: `<p>Every administration must be signed. Enter your initials to continue.</p>
             <div class="field"><label for="mInit">Nurse initials</label><input id="mInit" maxlength="4" style="text-transform:uppercase"></div>`,
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Continue', value: 'ok', kind: 'primary',
        validate: () => $('mInit').value.trim() ? '' : 'Initials are required.' }] });
    if (r.value !== 'ok') return;
    state.nurse = r.fields.mInit.toUpperCase(); $('nurseInit').value = state.nurse; saveState();
  }

  // 2. Allergies must be reviewed before ANY medication
  if (!allergyReviewed(p)) {
    logEvent(p, order, [{ severity: 'stop', type: 'Allergy not reviewed', title: 'Tried to give medication before reviewing allergies' }], 'Blocked');
    const r = await modal({ tone: 'stop', icon: '⛔', title: 'Allergies have not been reviewed',
      body: `<p class="big-note">You must review ${esc(p.name)}'s allergies before giving any medication.</p>
             <p>Medication: <b>${esc(drug.name)} ${order.dose} ${esc(order.unit)} ${esc(order.route)}</b></p>`,
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Review allergies now', value: 'review', kind: 'primary' }] });
    renderLog();
    if (r.value !== 'review') return;
    const ok = await showAllergyReview(p);
    if (!ok) return;
  }

  // 3. Safety checks
  const alerts = runSafetyChecks(p, order, slot);
  let reason = '', verifier = '';
  if (alerts.length) {
    const hasStop = alerts.some(a => a.severity === 'stop');
    const hasTiming = alerts.some(a => a.type === 'Early dose' || a.type === 'Late dose');
    const r = await modal({
      tone: hasStop ? 'stop' : 'warn', icon: hasStop ? '⛔' : '⚠',
      title: hasStop ? `HARD STOP: ${alerts.filter(a => a.severity === 'stop').length} critical alert(s)` : `${alerts.length} safety warning(s)`,
      body: `${rxSummary(p, order, slot)}
        ${alerts.map(a => `<div class="alert-item ${a.severity}"><div class="a-type">${a.severity === 'stop' ? 'Hard stop' : a.severity === 'warn' ? 'Warning' : 'Info'} · ${esc(a.type)}</div>
          <div class="a-title">${esc(a.title)}</div><div class="a-msg">${esc(a.msg)}</div></div>`).join('')}
        <label class="check"><input type="checkbox" id="mAck"> I have read every alert above and assessed the patient.</label>
        <div class="field"><label for="mReason">Override reason ${hasTiming ? '(early/late reason required)' : ''}</label>
          <select id="mReason">
            <option value="">Select…</option>
            ${hasTiming ? '<option>Patient off unit (test/procedure)</option><option>Medication not available / pharmacy delay</option><option>Patient refused at scheduled time</option><option>Changed schedule per provider</option>' : ''}
            <option>Provider notified and ordered to give</option>
            <option>Pharmacist consulted, okay to give</option>
            <option>Benefit outweighs risk, provider aware</option>
            <option>Other (see comment)</option>
          </select></div>
        <div class="field"><label for="mComment">Comment</label><textarea id="mComment" placeholder="Who was notified, what was said…"></textarea></div>
        ${hasStop ? `<div class="field"><label for="mVerifier">Second RN verification (required to override a hard stop)</label><input id="mVerifier" placeholder="Second nurse name"></div>` : ''}`,
      buttons: [
        { label: 'Cancel, do not give', value: 'cancel' },
        { label: 'Hold dose', value: 'hold' },
        { label: hasStop ? 'Override & continue' : 'Proceed', value: 'override', kind: hasStop ? 'danger' : 'primary',
          validate: () => {
            if (!$('mAck').checked) return 'Confirm you have read the alerts.';
            if (!$('mReason').value) return 'Select an override reason.';
            if ($('mReason').value.startsWith('Other') && !$('mComment').value.trim()) return 'Add a comment explaining the override.';
            if (hasStop && !$('mVerifier').value.trim()) return 'A second RN must verify a hard-stop override.';
            return '';
          } },
      ],
    });
    if (r.value === 'cancel' || r.value === 'dismiss') { logEvent(p, order, alerts, 'Cancelled'); return render(); }
    if (r.value === 'hold') return holdDose(p, order, slot, alerts);
    reason = r.fields.mReason + (r.fields.mComment ? `: ${r.fields.mComment}` : '');
    verifier = r.fields.mVerifier || '';
  }

  // 4. Rapid-acting insulin: meal tray check
  if (drug.rapidInsulin) {
    const g = labsOf(p).Glucose;
    const r = await modal({ tone: 'meal', icon: '🍽', title: 'Rapid-acting insulin: is the meal tray ready?',
      body: `<p class="big-note">Have the meal tray at the bedside before giving ${esc(drug.name)}.</p>
        <p>Onset is about 10–15 minutes. If the patient doesn't eat soon after, they can become hypoglycemic. Current blood glucose: <b>${g ?? '—'} mg/dL</b>.</p>
        <label class="check"><input type="checkbox" id="mTray"> The meal tray is at the bedside (or will arrive within 15 min).</label>
        <label class="check"><input type="checkbox" id="mEat"> The patient is not NPO and is able and willing to eat.</label>
        <label class="check"><input type="checkbox" id="mBg"> Blood glucose was checked within the last hour.</label>`,
      buttons: [{ label: 'Tray not ready, wait', value: 'wait' },
        { label: 'Tray ready, continue', value: 'ok', kind: 'primary',
          validate: () => ['mTray', 'mEat', 'mBg'].every(id => $(id).checked) ? '' : 'All three items must be confirmed.' }] });
    if (r.value !== 'ok') {
      logEvent(p, order, [{ severity: 'info', type: 'Meal tray check', title: 'Meal tray not ready, insulin deferred' }], 'Cancelled');
      return render();
    }
  }

  // 5. Document
  const doc = await documentDose(p, order, slot);
  if (!doc) { if (alerts.length) logEvent(p, order, alerts, 'Cancelled'); return render(); }
  state.admins.push(doc);
  if (alerts.length) logEvent(p, order, alerts, 'Given (override)', reason, verifier);
  else saveState();
  render();
}

function rxSummary(p, order, slot) {
  const d = drugOf(order);
  return `<div class="rx-summary"><b>${esc(d.name)} ${order.dose} ${esc(order.unit)}</b> · ${esc(order.route)} · ${esc(order.freq)}<br>
    <span style="color:var(--muted)">${esc(p.name)} · ${slot ? 'Scheduled ' + slot : 'PRN'} · Now ${hhmm(now())}</span></div>`;
}

async function documentDose(p, order, slot) {
  const needsSite = ['SubQ', 'IM', 'IV'].includes(order.route);
  const sites = order.route === 'IV' ? ['Existing IV, R forearm', 'Existing IV, L forearm', 'Existing IV, R AC', 'Existing IV, L AC', 'Central line']
    : ['Abdomen, LUQ', 'Abdomen, RUQ', 'Abdomen, LLQ', 'Abdomen, RLQ', 'L upper arm', 'R upper arm', 'L thigh', 'R thigh'];
  const r = await modal({ tone: 'info', icon: '✍', title: 'Document administration',
    body: `${rxSummary(p, order, slot)}
      <div class="row2">
        <div class="field"><label>Time given</label><input value="${hhmm(now())}" disabled></div>
        <div class="field"><label>Dose given</label><input value="${order.dose} ${esc(order.unit)}" disabled></div>
      </div>
      ${needsSite ? `<div class="field"><label for="mSite">${order.route === 'IV' ? 'IV access' : 'Injection site'}</label>
        <select id="mSite"><option value="">Select…</option>${sites.map(s => `<option>${s}</option>`).join('')}</select>
        ${order.route === 'SubQ' ? '<div class="hint">Rotate injection sites.</div>' : ''}</div>` : ''}
      ${order.prn ? `<div class="field"><label for="mPrn">PRN reason / assessment</label><input id="mPrn" placeholder="e.g. Pain 7/10 RUQ incision"></div>` : ''}
      <div class="field"><label for="mNote">Comment (optional)</label><textarea id="mNote"></textarea></div>
      <label class="check"><input type="checkbox" id="mRights"> Verified the rights: right patient (2 identifiers), drug, dose, route, time, and documentation.</label>
      <div class="hint" style="margin-top:6px">Signing as <b>${esc(state.nurse)}</b></div>`,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Sign & document', value: 'ok', kind: 'primary',
      validate: () => {
        if (needsSite && !$('mSite').value) return 'Select the site.';
        if (order.prn && !$('mPrn').value.trim()) return 'Document the reason for the PRN dose.';
        if (!$('mRights').checked) return 'Confirm the rights of medication administration.';
        return '';
      } }] });
  if (r.value !== 'ok') return null;
  return { id: uid(), patientId: p.id, orderId: order.id, slot: slot || null, dateKey: dayKey(), givenAt: now().toISOString(),
    status: 'given', dose: order.dose, nurse: state.nurse, site: r.fields.mSite || '',
    comment: [r.fields.mPrn, r.fields.mNote].filter(Boolean).join(' · ') };
}

async function holdDose(p, order, slot, alerts = []) {
  const r = await modal({ tone: 'warn', icon: '✋', title: 'Hold dose',
    body: `${rxSummary(p, order, slot)}
      <div class="field"><label for="mHold">Reason held</label><select id="mHold"><option value="">Select…</option>
        <option>Held per parameters (lab/vital sign)</option><option>Allergy, provider notified</option><option>Patient refused</option>
        <option>Patient NPO</option><option>Patient off unit</option><option>Provider order to hold</option><option>Other</option></select></div>
      <div class="field"><label for="mHoldNote">Comment / provider notified</label><textarea id="mHoldNote"></textarea></div>`,
    buttons: [{ label: 'Back', value: 'cancel' }, { label: 'Document hold', value: 'ok', kind: 'primary',
      validate: () => $('mHold').value ? '' : 'Select a reason.' }] });
  if (r.value !== 'ok') { if (alerts.length) logEvent(p, order, alerts, 'Cancelled'); return render(); }
  const reason = r.fields.mHold + (r.fields.mHoldNote ? `: ${r.fields.mHoldNote}` : '');
  state.admins.push({ id: uid(), patientId: p.id, orderId: order.id, slot: slot || null, dateKey: dayKey(), givenAt: now().toISOString(),
    status: 'held', dose: 0, nurse: state.nurse, comment: reason });
  logEvent(p, order, alerts, 'Held', reason);
  render();
}

async function showRecord(p, rec) {
  const order = p.orders.find(o => o.id === rec.orderId);
  const r = await modal({ tone: 'info', icon: rec.status === 'given' ? '✓' : '✋',
    title: `${drugOf(order).name}: ${rec.status === 'given' ? 'given' : 'held'}`,
    body: `<p><b>${rec.status === 'given' ? 'Given' : 'Held'}</b> at ${hhmm(new Date(rec.givenAt))} by ${esc(rec.nurse)}${rec.slot ? ` (scheduled ${rec.slot})` : ''}.</p>
      ${rec.site ? `<p>Site: ${esc(rec.site)}</p>` : ''}${rec.comment ? `<p>Comment: ${esc(rec.comment)}</p>` : ''}
      <p style="color:var(--muted);font-size:13px">This dose is already documented. Giving it again would be a duplicate dose.</p>`,
    buttons: [{ label: 'Remove (charted in error)', value: 'remove' }, { label: 'Close', value: 'close', kind: 'primary' }] });
  if (r.value === 'remove') {
    state.admins = state.admins.filter(a => a.id !== rec.id);
    logEvent(p, order, [], 'Removed', 'Charted in error');
    render();
  }
}

async function showAllergyReview(p) {
  const r = await modal({ tone: p.allergies.length ? 'stop' : 'info', icon: '⚠', title: `Allergy review: ${p.name}`,
    body: p.allergies.length ? `
      <table class="allergy-table"><thead><tr><th>Allergen</th><th>Reaction</th><th>Severity</th></tr></thead>
      <tbody>${p.allergies.map(a => `<tr><td><b>${esc(a.substance)}</b></td><td>${esc(a.reaction)}</td><td>${esc(a.severity)}</td></tr>`).join('')}</tbody></table>
      <label class="check"><input type="checkbox" id="mBand"> Allergy band on the patient matches this list.</label>
      <label class="check"><input type="checkbox" id="mAsk"> Asked the patient/family about any new allergies.</label>`
      : `<p class="big-note">No known drug allergies (NKDA).</p>
      <label class="check"><input type="checkbox" id="mBand"> Confirmed NKDA with the patient/family and the armband.</label>
      <label class="check" style="display:none"><input type="checkbox" id="mAsk" checked></label>`,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Mark allergies reviewed', value: 'ok', kind: 'primary',
      validate: () => $('mBand').checked && $('mAsk').checked ? '' : 'Confirm both items.' }] });
  if (r.value !== 'ok') return false;
  state.reviewed[p.id] = now().toISOString();
  saveState(); render();
  return true;
}

async function showLabEditor(p) {
  const labs = labsOf(p);
  const r = await modal({ tone: 'info', icon: '🧪', title: 'Update labs & vital signs',
    body: `<p style="color:var(--muted);font-size:14px">Change values to test lab-based alerts (e.g. set potassium to 3.1 before digoxin, or glucose to 62 before insulin).</p>
      <div class="labs-form">${Object.keys(LAB_INFO).map(k => `
        <div class="field"><label for="lab_${k}">${esc(LAB_INFO[k].label)} <span style="color:var(--muted);font-weight:400">${esc(LAB_INFO[k].unit)}</span></label>
        <input id="lab_${k}" type="number" step="any" value="${labs[k] ?? ''}"><div class="hint">${esc(LAB_INFO[k].normal)}</div></div>`).join('')}</div>`,
    buttons: [{ label: 'Restore original', value: 'reset' }, { label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'ok', kind: 'primary' }] });
  if (r.value === 'reset') { delete state.labs[p.id]; }
  else if (r.value === 'ok') {
    state.labs[p.id] = {};
    for (const k of Object.keys(LAB_INFO)) {
      const v = r.fields['lab_' + k];
      state.labs[p.id][k] = v === '' ? null : Number(v);
    }
  } else return;
  saveState(); render();
}

/* ===================== 6. MODALS & MISC ===================== */
/* modal({tone, icon, title, body, buttons:[{label, value, kind, validate}]}) -> Promise<{value, fields}> */
function modal({ tone = 'info', icon = '', title, body, buttons }) {
  return new Promise(resolve => {
    const wrap = $('modalWrap'), box = $('modal');
    box.className = 'modal tone-' + tone;
    box.innerHTML = `
      <div class="modal-head"><span class="ico">${icon}</span><h2 id="modalTitle">${esc(title)}</h2></div>
      <div class="modal-body">${body}<div class="err" id="modalErr"></div></div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    wrap.classList.add('open'); wrap.setAttribute('aria-hidden', 'false');
    const first = box.querySelector('input:not([disabled]), select, textarea') || box.querySelector('.modal-foot .btn:last-child');
    if (first) first.focus();

    const collect = () => {
      const f = {};
      box.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => { f[el.id] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      return f;
    };
    const close = (value) => {
      wrap.classList.remove('open'); wrap.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
      resolve({ value, fields: collect() });
    };
    const onKey = e => { if (e.key === 'Escape') close('dismiss'); };
    document.addEventListener('keydown', onKey);
    box.querySelectorAll('.modal-foot .btn').forEach(btn => btn.onclick = () => {
      const b = buttons[btn.dataset.i];
      const err = b.validate ? b.validate() : '';
      if (err) { $('modalErr').textContent = err; return; }
      close(b.value);
    });
  });
}

/* ----- Event wiring ----- */
document.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab) { currentPatientId = tab.dataset.pid; saveState(); return render(); }
  const p = patient();
  const rec = e.target.closest('[data-rec]');
  if (rec) return showRecord(p, state.admins.find(a => a.id === rec.dataset.rec));
  const el = e.target.closest('[data-order]');
  if (el && !$('modalWrap').classList.contains('open')) {
    const order = p.orders.find(o => o.id === el.dataset.order);
    startAdministration(p, order, el.dataset.slot || null);
  }
});

function shiftClock(ms) { state.simOffsetMs = (state.simOffsetMs || 0) + ms; saveState(); render(); }
$('minusHr').onclick = () => shiftClock(-3600000);
$('plusHr').onclick = () => shiftClock(3600000);
$('clockLive').onclick = () => { state.simOffsetMs = null; saveState(); render(); };
$('clockSet').onchange = e => {
  if (!e.target.value) return;
  const target = slotDate(e.target.value, dayKey(new Date()));
  state.simOffsetMs = target - Date.now();
  saveState(); render();
};
$('nurseInit').value = state.nurse;
$('nurseInit').oninput = e => { state.nurse = e.target.value.trim().toUpperCase(); saveState(); };
$('resetBtn').onclick = async () => {
  const r = await modal({ tone: 'warn', icon: '↺', title: 'Reset demo data?',
    body: '<p>This clears all documented doses, the alert log, edited labs, and allergy reviews on this browser.</p>',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Reset', value: 'ok', kind: 'danger' }] });
  if (r.value !== 'ok') return;
  const nurse = state.nurse;
  state = defaultState(); state.nurse = nurse; saveState(); render();
};
$('themeBtn').onclick = () => {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) {}
};

render();
setInterval(() => { if (!$('modalWrap').classList.contains('open')) render(); }, 20000);
