// =============================================================================
// loads.js — external forces and torques on links, and how they vary
// -----------------------------------------------------------------------------
//   doc.loads = [{
//     id, link,                 the link it acts on
//     kind: 'force' | 'torque',
//     at: { x, y },             point of action, design-pose world mm (force)
//     F: { x, y },              force in N (directions in world axes)
//     T,                        torque in N·m, counter-clockwise + (torque)
//     follow: false,            true = the force turns with the link
//     profile: { type: 'constant' | 'table' | 'formula', table, expr },
//   }]
// The profile is a FACTOR on F or T that changes over the cycle:
//   table    rows [input, factor] — input in degrees (motor) or mm (linear);
//            straight lines between rows, flat beyond the ends
//   formula  an expression in: theta (input, degrees), s (input, mm),
//            t (time, s, from the drawn position at the input speed),
//            pi, e; functions sin cos tan (degrees), asin acos atan atan2
//            (give degrees), sqrt abs exp ln log10 min max floor ceil
//            round sign, step(x) (0 below 0, 1 from 0), pulse(x, a, b)
//            (1 when a ≤ x ≤ b); operators + − × / ^ ( ) and comparisons.
// =============================================================================

const D = Math.PI / 180;

// ---- a small, safe expression evaluator --------------------------------------

const FUNCS = {
  sin: (x) => Math.sin(x * D), cos: (x) => Math.cos(x * D), tan: (x) => Math.tan(x * D),
  asin: (x) => Math.asin(x) / D, acos: (x) => Math.acos(x) / D, atan: (x) => Math.atan(x) / D,
  atan2: (y, x) => Math.atan2(y, x) / D,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log10: Math.log10,
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  step: (x) => (x >= 0 ? 1 : 0),
  pulse: (x, a, b) => (x >= a && x <= b ? 1 : 0),
};
const CONSTS = { pi: Math.PI, e: Math.E };
/** How many numbers each function takes [least, most]; one when not listed. */
const ARITY = { atan2: [2, 2], min: [1, 20], max: [1, 20], pulse: [3, 3] };

/**
 * Compile an expression to a function of variables. Throws an Error with a
 * plain message (shown to the student) if it cannot be read.
 */
export function compileFormula(text) {
  const src = String(text || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/θ/g, 'theta');
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(<=|>=|==|!=|[-+*/^(),<>]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Cannot read the formula near “${src.slice(pos, pos + 8).trim()}”.`);
    pos = re.lastIndex;
    tokens.push(m[1] !== undefined ? { t: 'num', v: parseFloat(m[1]) } : m[2] !== undefined ? { t: 'id', v: m[2] } : { t: 'op', v: m[3] });
  }
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (v) => { const k = next(); if (!k || k.v !== v) throw new Error(`Expected “${v}” in the formula.`); };
  // precedence: comparison < additive < multiplicative < unary < power
  function comparison() {
    let a = additive();
    while (peek() && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = next().v, b = additive(), x = a, y = b;
      a = { '<': (v) => +(x(v) < y(v)), '>': (v) => +(x(v) > y(v)), '<=': (v) => +(x(v) <= y(v)), '>=': (v) => +(x(v) >= y(v)), '==': (v) => +(x(v) === y(v)), '!=': (v) => +(x(v) !== y(v)) }[op];
    }
    return a;
  }
  function additive() {
    let a = multiplicative();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = next().v, b = multiplicative(), x = a;
      a = op === '+' ? (v) => x(v) + b(v) : (v) => x(v) - b(v);
    }
    return a;
  }
  function multiplicative() {
    let a = unary();
    while (peek() && (peek().v === '*' || peek().v === '/')) {
      const op = next().v, b = unary(), x = a;
      a = op === '*' ? (v) => x(v) * b(v) : (v) => x(v) / b(v);
    }
    return a;
  }
  function unary() {
    if (peek() && peek().v === '-') { next(); const a = unary(); return (v) => -a(v); }
    if (peek() && peek().v === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const a = primary();
    if (peek() && peek().v === '^') { next(); const b = unary(); return (v) => a(v) ** b(v); }
    return a;
  }
  function primary() {
    const k = next();
    if (!k) throw new Error('The formula ends too early.');
    if (k.t === 'num') return () => k.v;
    if (k.v === '(') { const a = comparison(); expect(')'); return a; }
    if (k.t === 'id') {
      if (peek() && peek().v === '(') {
        if (!Object.hasOwn(FUNCS, k.v)) throw new Error(`Unknown function “${k.v}”.`);
        const f = FUNCS[k.v];
        next();
        const args = [];
        if (peek() && peek().v !== ')') { args.push(comparison()); while (peek() && peek().v === ',') { next(); args.push(comparison()); } }
        expect(')');
        const [lo, hi] = ARITY[k.v] || [1, 1];
        if (args.length < lo || args.length > hi) {
          throw new Error(`${k.v}() takes ${lo === hi ? lo : `${lo} to ${hi}`} number${hi === 1 ? '' : 's'}.`);
        }
        return (v) => f(...args.map((g) => g(v)));
      }
      if (Object.hasOwn(CONSTS, k.v)) return () => CONSTS[k.v];
      if (['theta', 's', 't'].includes(k.v)) return (v) => v[k.v];
      throw new Error(`Unknown name “${k.v}”. Use theta, s or t.`);
    }
    throw new Error(`Unexpected “${k.v}” in the formula.`);
  }
  if (!tokens.length) throw new Error('The formula is empty.');
  const f = comparison();
  if (i < tokens.length) throw new Error(`Unexpected “${tokens[i].v}” in the formula.`);
  return (vars) => f(vars);
}

const cache = new Map();
/** Formula → function, compiled once. Returns null (and the message) if it is wrong. */
export function formulaFn(text) {
  if (!cache.has(text)) {
    try { cache.set(text, { f: compileFormula(text), error: null }); } catch (e) { cache.set(text, { f: null, error: e.message }); }
  }
  return cache.get(text);
}

/** Factor of a profile at input value x (deg or mm), stroke s (mm) and time t (s). */
export function profileFactor(profile, vars) {
  if (!profile || profile.type === 'constant' || !profile.type) return 1;
  if (profile.type === 'table') {
    const rows = (profile.table || []).filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1])).sort((a, b) => a[0] - b[0]);
    if (!rows.length) return 1;
    const x = vars.x;
    if (x <= rows[0][0]) return rows[0][1];
    for (let k = 1; k < rows.length; k++) {
      if (x <= rows[k][0]) {
        const [x0, y0] = rows[k - 1], [x1, y1] = rows[k];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return rows[rows.length - 1][1];
  }
  if (profile.type === 'formula') {
    const c = formulaFn(profile.expr || '1');
    if (!c.f) return NaN;
    const v = c.f(vars);
    return Number.isFinite(v) ? v : NaN;
  }
  return 1;
}

/**
 * Parse pasted table text (from Excel: two columns, tab/comma/space
 * separated; a header line is skipped) into rows [input, factor].
 */
export function parseTable(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    // tab or semicolon separated (Excel in many locales) may use decimal commas
    const parts = (/[\t;]/.test(t) ? t.split(/[\t;]+/).map((s) => s.trim().replace(',', '.')) : t.split(/[\s,]+/))
      .map((s) => Number(s.replace('−', '-')));
    if (parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite)) rows.push([parts[0], parts[1]]);
  }
  return rows;
}

/** A new load on a link at a design-pose point (its id comes from the document). */
export function makeLoad(doc, link, at, kind = 'force') {
  const id = `f${doc.nextId++}`;
  return kind === 'torque'
    ? { id, link, kind, at: { ...at }, T: 1, follow: false, profile: { type: 'constant' } }
    : { id, link, kind, at: { ...at }, F: { x: 0, y: -10 }, follow: false, profile: { type: 'constant' } };
}
