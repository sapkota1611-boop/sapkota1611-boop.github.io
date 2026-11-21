/* =====================================================================
   MAR DATA — drugs, safety rules, and sample patients.
   Everything the alert engine checks lives in this file, so new drugs,
   interactions, or patients can be added here without touching mar.js.

   EDUCATIONAL DEMO ONLY. Patients are fictional and the rules below are
   simplified teaching examples, not a complete clinical reference.
   ===================================================================== */

/* ---------- Drug database ----------
   classes:      used for allergy matching and class-based interactions
   allergyGroups: an allergy to any of these groups = HARD STOP
   crossGroups:  an allergy to any of these groups = cross-sensitivity WARNING
   timeCritical: true -> ±30 min window, otherwise ±60 min
   rapidInsulin: true -> "meal tray ready?" prompt before giving
   checks:       lab / vital-sign rules evaluated before every dose
                 { key, op: '<' | '>', value, severity: 'stop' | 'warn', msg }
*/
const DRUGS = {
  digoxin: {
    name: 'Digoxin', classes: ['cardiac glycoside'],
    checks: [
      { key: 'K',   op: '<', value: 3.5, severity: 'stop', msg: 'Potassium is LOW. Hypokalemia greatly increases the risk of digoxin toxicity (dysrhythmias). Hold and notify the provider.' },
      { key: 'HR',  op: '<', value: 60,  severity: 'stop', msg: 'Apical pulse below 60 bpm. Hold digoxin and notify the provider.' },
      { key: 'Dig', op: '>', value: 2.0, severity: 'stop', msg: 'Digoxin level above 2.0 ng/mL (toxic range). Hold and notify the provider.' },
      { key: 'Mg',  op: '<', value: 1.7, severity: 'warn', msg: 'Magnesium is LOW. Hypomagnesemia also increases digoxin toxicity risk.' },
    ],
  },
  furosemide: {
    name: 'Furosemide', classes: ['loop diuretic', 'sulfonamide (non-antibiotic)'],
    crossGroups: ['sulfa'],
    checks: [
      { key: 'K',   op: '<', value: 3.5, severity: 'warn', msg: 'Potassium is LOW. Loop diuretics waste potassium further. Notify the provider.' },
      { key: 'SBP', op: '<', value: 90,  severity: 'warn', msg: 'Systolic BP below 90 mmHg. Diuresis may worsen hypotension.' },
    ],
  },
  metoprolol: {
    name: 'Metoprolol tartrate', classes: ['beta blocker'],
    checks: [
      { key: 'HR',  op: '<', value: 60,  severity: 'stop', msg: 'Heart rate below 60 bpm. Hold beta blocker per parameters.' },
      { key: 'SBP', op: '<', value: 100, severity: 'stop', msg: 'Systolic BP below 100 mmHg. Hold beta blocker per parameters.' },
    ],
  },
  diltiazem: {
    name: 'Diltiazem', classes: ['calcium channel blocker'],
    checks: [
      { key: 'HR',  op: '<', value: 60,  severity: 'stop', msg: 'Heart rate below 60 bpm. Hold and notify the provider.' },
      { key: 'SBP', op: '<', value: 100, severity: 'stop', msg: 'Systolic BP below 100 mmHg. Hold and notify the provider.' },
    ],
  },
  warfarin: {
    name: 'Warfarin', classes: ['anticoagulant'],
    checks: [
      { key: 'INR', op: '>', value: 3.0, severity: 'stop', msg: 'INR above 3.0. Bleeding risk is high. Hold and notify the provider.' },
    ],
  },
  potassium_chloride: {
    name: 'Potassium chloride', classes: ['electrolyte', 'potassium supplement'],
    checks: [
      { key: 'K',  op: '>', value: 5.0, severity: 'stop', msg: 'Potassium is HIGH. Giving more potassium risks fatal dysrhythmias.' },
      { key: 'Cr', op: '>', value: 2.0, severity: 'warn', msg: 'Creatinine is elevated. Reduced kidney function can cause potassium to build up.' },
    ],
  },
  lisinopril: {
    name: 'Lisinopril', classes: ['ace inhibitor'],
    checks: [
      { key: 'SBP', op: '<', value: 100, severity: 'stop', msg: 'Systolic BP below 100 mmHg. Hold and notify the provider.' },
      { key: 'K',   op: '>', value: 5.0, severity: 'warn', msg: 'Potassium is HIGH. ACE inhibitors raise potassium further.' },
    ],
  },
  spironolactone: {
    name: 'Spironolactone', classes: ['potassium-sparing diuretic'],
    checks: [
      { key: 'K', op: '>', value: 5.0, severity: 'stop', msg: 'Potassium is HIGH. Potassium-sparing diuretics can cause life-threatening hyperkalemia.' },
    ],
  },
  insulin_lispro: {
    name: 'Insulin lispro (rapid-acting)', classes: ['insulin', 'rapid-acting insulin'],
    rapidInsulin: true, timeCritical: true,
    checks: [
      { key: 'Glucose', op: '<', value: 70, severity: 'stop', msg: 'Blood glucose below 70 mg/dL. Do NOT give insulin. Treat hypoglycemia per protocol.' },
    ],
  },
  insulin_aspart: {
    name: 'Insulin aspart (rapid-acting)', classes: ['insulin', 'rapid-acting insulin'],
    rapidInsulin: true, timeCritical: true,
    checks: [
      { key: 'Glucose', op: '<', value: 70, severity: 'stop', msg: 'Blood glucose below 70 mg/dL. Do NOT give insulin. Treat hypoglycemia per protocol.' },
    ],
  },
  insulin_glargine: {
    name: 'Insulin glargine (long-acting)', classes: ['insulin', 'long-acting insulin'],
    checks: [
      { key: 'Glucose', op: '<', value: 70, severity: 'stop', msg: 'Blood glucose below 70 mg/dL. Hold and notify the provider.' },
    ],
  },
  piperacillin_tazobactam: {
    name: 'Piperacillin-tazobactam', classes: ['penicillin', 'beta-lactam antibiotic'],
    allergyGroups: ['penicillin'], timeCritical: true, checks: [],
  },
  amoxicillin: {
    name: 'Amoxicillin', classes: ['penicillin', 'beta-lactam antibiotic'],
    allergyGroups: ['penicillin'], checks: [],
  },
  ceftriaxone: {
    name: 'Ceftriaxone', classes: ['cephalosporin', 'beta-lactam antibiotic'],
    allergyGroups: ['cephalosporin'], crossGroups: ['penicillin'], timeCritical: true, checks: [],
  },
  sulfamethoxazole_trimethoprim: {
    name: 'Sulfamethoxazole-trimethoprim', classes: ['sulfonamide antibiotic'],
    allergyGroups: ['sulfa'], checks: [],
  },
  acetaminophen: {
    name: 'Acetaminophen', classes: ['analgesic'], checks: [],
  },
  ibuprofen: {
    name: 'Ibuprofen', classes: ['nsaid'], allergyGroups: ['nsaid'],
    checks: [
      { key: 'Cr', op: '>', value: 1.5, severity: 'warn', msg: 'Creatinine is elevated. NSAIDs can worsen kidney function.' },
    ],
  },
  ketorolac: {
    name: 'Ketorolac', classes: ['nsaid'], allergyGroups: ['nsaid'],
    checks: [
      { key: 'Cr', op: '>', value: 1.5, severity: 'warn', msg: 'Creatinine is elevated. NSAIDs can worsen kidney function.' },
    ],
  },
  aspirin: {
    name: 'Aspirin', classes: ['antiplatelet', 'nsaid'], allergyGroups: ['nsaid', 'aspirin'], checks: [],
  },
  morphine: {
    name: 'Morphine', classes: ['opioid'], allergyGroups: ['morphine', 'opioid'],
    checks: [
      { key: 'RR',  op: '<', value: 12, severity: 'stop', msg: 'Respiratory rate below 12/min. Hold opioid; assess sedation level.' },
      { key: 'SBP', op: '<', value: 90, severity: 'warn', msg: 'Systolic BP below 90 mmHg. Opioids can cause hypotension.' },
    ],
  },
  hydromorphone: {
    name: 'Hydromorphone', classes: ['opioid'], allergyGroups: ['opioid'], crossGroups: ['morphine'],
    checks: [
      { key: 'RR',  op: '<', value: 12, severity: 'stop', msg: 'Respiratory rate below 12/min. Hold opioid; assess sedation level.' },
      { key: 'SBP', op: '<', value: 90, severity: 'warn', msg: 'Systolic BP below 90 mmHg. Opioids can cause hypotension.' },
    ],
  },
  tramadol: {
    name: 'Tramadol', classes: ['opioid', 'serotonergic'], allergyGroups: ['opioid'],
    checks: [
      { key: 'RR', op: '<', value: 12, severity: 'stop', msg: 'Respiratory rate below 12/min. Hold opioid; assess sedation level.' },
    ],
  },
  lorazepam: {
    name: 'Lorazepam', classes: ['benzodiazepine'],
    checks: [
      { key: 'RR', op: '<', value: 12, severity: 'stop', msg: 'Respiratory rate below 12/min. Hold sedative.' },
    ],
  },
  sertraline: {
    name: 'Sertraline', classes: ['ssri', 'serotonergic'], checks: [],
  },
  ondansetron: {
    name: 'Ondansetron', classes: ['antiemetic', 'serotonergic'], checks: [],
  },
  pantoprazole: {
    name: 'Pantoprazole', classes: ['proton pump inhibitor'], checks: [],
  },
};

/* ---------- Drug–drug interactions ----------
   a / b: a drug key (e.g. 'digoxin') or a class with the 'class:' prefix.
   Fires when one drug is being given and the other was given within the
   last INTERACTION_LOOKBACK_HRS or is due within the same time window.
*/
const INTERACTION_LOOKBACK_HRS = 24;

const INTERACTIONS = [
  { a: 'digoxin', b: 'furosemide', severity: 'warn',
    msg: 'Loop diuretics deplete potassium and magnesium, which increases the risk of digoxin toxicity. Check K+ and Mg before giving.' },
  { a: 'digoxin', b: 'class:potassium-sparing diuretic', severity: 'warn',
    msg: 'Spironolactone can raise digoxin levels. Monitor for digoxin toxicity.' },
  { a: 'digoxin', b: 'class:calcium channel blocker', severity: 'warn',
    msg: 'Additive slowing of heart rate (AV block risk). Check apical pulse.' },
  { a: 'warfarin', b: 'class:nsaid', severity: 'stop',
    msg: 'NSAIDs / aspirin plus warfarin greatly increases bleeding risk (GI bleed). Clarify with the provider.' },
  { a: 'warfarin', b: 'class:antiplatelet', severity: 'stop',
    msg: 'Antiplatelet plus anticoagulant increases bleeding risk. Confirm this combination is intended.' },
  { a: 'class:ace inhibitor', b: 'class:potassium-sparing diuretic', severity: 'warn',
    msg: 'ACE inhibitor plus potassium-sparing diuretic can cause hyperkalemia. Check K+.' },
  { a: 'class:ace inhibitor', b: 'potassium_chloride', severity: 'warn',
    msg: 'ACE inhibitor plus potassium supplement can cause hyperkalemia. Check K+.' },
  { a: 'class:potassium-sparing diuretic', b: 'potassium_chloride', severity: 'stop',
    msg: 'Potassium-sparing diuretic plus potassium supplement: high risk of life-threatening hyperkalemia.' },
  { a: 'class:opioid', b: 'class:benzodiazepine', severity: 'stop',
    msg: 'Opioid plus benzodiazepine (FDA boxed warning): profound sedation, respiratory depression, death. Assess RR, SpO2, and sedation.' },
  { a: 'class:opioid', b: 'class:opioid', severity: 'warn', lookbackHrs: 4,
    msg: 'Two opioids close together (therapeutic duplication). Increased risk of respiratory depression.' },
  { a: 'class:nsaid', b: 'class:nsaid', severity: 'warn', lookbackHrs: 6,
    msg: 'Two NSAIDs close together (therapeutic duplication). Increased GI bleed and kidney injury risk.' },
  { a: 'class:ssri', b: 'tramadol', severity: 'stop',
    msg: 'SSRI plus tramadol: risk of serotonin syndrome and seizures.' },
  { a: 'class:beta blocker', b: 'class:calcium channel blocker', severity: 'warn',
    msg: 'Beta blocker plus non-dihydropyridine CCB: risk of severe bradycardia and heart block.' },
];

/* ---------- Lab / vital-sign labels ---------- */
const LAB_INFO = {
  K:       { label: 'Potassium',   unit: 'mEq/L', normal: '3.5–5.0', lo: 3.5, hi: 5.0 },
  Mg:      { label: 'Magnesium',   unit: 'mg/dL', normal: '1.7–2.2', lo: 1.7, hi: 2.2 },
  Glucose: { label: 'Glucose',     unit: 'mg/dL', normal: '70–180 (inpatient)', lo: 70, hi: 180 },
  INR:     { label: 'INR',         unit: '',      normal: '0.8–1.2 (2–3 on warfarin)', lo: null, hi: 3.0 },
  Cr:      { label: 'Creatinine',  unit: 'mg/dL', normal: '0.6–1.2', lo: 0.6, hi: 1.2 },
  Dig:     { label: 'Digoxin lvl', unit: 'ng/mL', normal: '0.5–2.0', lo: 0.5, hi: 2.0 },
  HR:      { label: 'Heart rate',  unit: 'bpm',   normal: '60–100', lo: 60, hi: 100 },
  SBP:     { label: 'Systolic BP', unit: 'mmHg',  normal: '90–140', lo: 90, hi: 140 },
  RR:      { label: 'Resp rate',   unit: '/min',  normal: '12–20', lo: 12, hi: 20 },
  SpO2:    { label: 'SpO2',        unit: '%',     normal: '≥ 95', lo: 95, hi: null },
};

/* ---------- Sample patients (fictional) ----------
   orders[].times:  scheduled 24h times; omit for PRN
   orders[].prn:    true for as-needed meds (needs minIntervalHrs)
   orders[].maxPer24h: optional max total amount in 24 h (same unit as dose)
*/
const PATIENTS = [
  {
    id: 'p1', name: 'Margaret Ellis', mrn: '00482913', dob: '1948-03-14', sex: 'F',
    room: '412-A', weightKg: 64, provider: 'Dr. R. Nguyen',
    diagnosis: 'Heart failure exacerbation, atrial fibrillation',
    allergies: [
      { substance: 'Penicillin', group: 'penicillin', reaction: 'Hives, throat swelling', severity: 'Severe' },
      { substance: 'Sulfa drugs', group: 'sulfa', reaction: 'Rash', severity: 'Moderate' },
    ],
    labs: { K: 3.2, Mg: 1.9, Glucose: 128, INR: 2.4, Cr: 1.3, Dig: 1.1, HR: 72, SBP: 118, RR: 18, SpO2: 95 },
    orders: [
      { id: 'o1', drug: 'digoxin', dose: 0.125, unit: 'mg', route: 'PO', freq: 'Daily', times: ['09:00'] },
      { id: 'o2', drug: 'furosemide', dose: 40, unit: 'mg', route: 'PO', freq: 'BID', times: ['09:00', '17:00'] },
      { id: 'o3', drug: 'metoprolol', dose: 25, unit: 'mg', route: 'PO', freq: 'BID', times: ['09:00', '21:00'], note: 'Hold if HR < 60 or SBP < 100' },
      { id: 'o4', drug: 'potassium_chloride', dose: 20, unit: 'mEq', route: 'PO', freq: 'BID', times: ['09:00', '17:00'] },
      { id: 'o5', drug: 'warfarin', dose: 5, unit: 'mg', route: 'PO', freq: 'Daily', times: ['17:00'] },
      { id: 'o6', drug: 'piperacillin_tazobactam', dose: 3.375, unit: 'g', route: 'IV', freq: 'q8h', times: ['06:00', '14:00', '22:00'] },
      { id: 'o7', drug: 'ceftriaxone', dose: 1, unit: 'g', route: 'IV', freq: 'Daily', times: ['10:00'] },
      { id: 'o8', drug: 'acetaminophen', dose: 650, unit: 'mg', route: 'PO', freq: 'q6h PRN pain/fever', prn: true, minIntervalHrs: 6, maxPer24h: 3000 },
      { id: 'o9', drug: 'ibuprofen', dose: 400, unit: 'mg', route: 'PO', freq: 'q6h PRN pain', prn: true, minIntervalHrs: 6 },
    ],
  },
  {
    id: 'p2', name: 'James Carter', mrn: '00519377', dob: '1964-09-02', sex: 'M',
    room: '305-B', weightKg: 98, provider: 'Dr. A. Brooks',
    diagnosis: 'Type 2 diabetes, post-op day 1 (cholecystectomy)',
    allergies: [
      { substance: 'Morphine', group: 'morphine', reaction: 'Severe itching, hypotension', severity: 'Moderate' },
      { substance: 'Latex', group: 'latex', reaction: 'Contact dermatitis', severity: 'Mild' },
    ],
    labs: { K: 4.6, Mg: 2.0, Glucose: 186, INR: 1.0, Cr: 1.0, Dig: null, HR: 84, SBP: 132, RR: 16, SpO2: 97 },
    orders: [
      { id: 'o1', drug: 'insulin_lispro', dose: 6, unit: 'units', route: 'SubQ', freq: 'AC (before meals)', times: ['07:30', '11:30', '16:30'], note: 'Give within 15 min of meal' },
      { id: 'o2', drug: 'insulin_glargine', dose: 20, unit: 'units', route: 'SubQ', freq: 'Daily at bedtime', times: ['21:00'] },
      { id: 'o3', drug: 'lisinopril', dose: 10, unit: 'mg', route: 'PO', freq: 'Daily', times: ['09:00'] },
      { id: 'o4', drug: 'spironolactone', dose: 25, unit: 'mg', route: 'PO', freq: 'Daily', times: ['09:00'] },
      { id: 'o5', drug: 'sertraline', dose: 50, unit: 'mg', route: 'PO', freq: 'Daily', times: ['09:00'] },
      { id: 'o6', drug: 'pantoprazole', dose: 40, unit: 'mg', route: 'PO', freq: 'Daily before breakfast', times: ['06:00'] },
      { id: 'o7', drug: 'hydromorphone', dose: 0.5, unit: 'mg', route: 'IV', freq: 'q3h PRN severe pain', prn: true, minIntervalHrs: 3 },
      { id: 'o8', drug: 'morphine', dose: 2, unit: 'mg', route: 'IV', freq: 'q4h PRN pain', prn: true, minIntervalHrs: 4 },
      { id: 'o9', drug: 'tramadol', dose: 50, unit: 'mg', route: 'PO', freq: 'q6h PRN moderate pain', prn: true, minIntervalHrs: 6, maxPer24h: 400 },
      { id: 'o10', drug: 'lorazepam', dose: 0.5, unit: 'mg', route: 'IV', freq: 'q6h PRN anxiety', prn: true, minIntervalHrs: 6 },
      { id: 'o11', drug: 'ondansetron', dose: 4, unit: 'mg', route: 'IV', freq: 'q6h PRN nausea', prn: true, minIntervalHrs: 6 },
    ],
  },
];
