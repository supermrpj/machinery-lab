// =============================================================================
// dxf2000.js — a minimal DXF R2000 (AC1015) writer with true SPLINE curves
// -----------------------------------------------------------------------------
// R12 (the format LinkLab writes) has no spline entity, so the cam profile is
// written in R2000, which SolidWorks, Inventor, Fusion 360, AutoCAD and
// LibreCAD read as one smooth spline. Only what a valid file needs is written:
// the tables, the model and paper space blocks, the entities and the root
// dictionary, each with a handle and its owner.
//
//   const d = new Dxf2000({ units: 'mm' });
//   d.layer('CAM', 1);
//   d.closedSpline('CAM', points);   d.circle('BORE', c, r);   d.arc(...)   d.line(...)
//   const text = d.toString();
// =============================================================================

const num = (v) => {
  if (!Number.isFinite(v)) return '0.0';
  const s = (Math.abs(v) < 1e-12 ? 0 : v).toFixed(8);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s;
};

/**
 * Control points of the closed (periodic) uniform cubic B-spline that passes
 * through points Q (in order, not repeating the first): solves
 * (P[i−1] + 4·P[i] + P[i+1]) / 6 = Q[i] round the loop.
 */
export function periodicCubicControlPoints(Q) {
  const n = Q.length;
  let P = Q.map((q) => ({ x: q.x, y: q.y }));
  // Gauss–Seidel: the system is strongly diagonally dominant (4 against 1 + 1)
  for (let it = 0; it < 200; it++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      const x = (6 * Q[i].x - a.x - b.x) / 4, y = (6 * Q[i].y - a.y - b.y) / 4;
      change = Math.max(change, Math.abs(x - P[i].x), Math.abs(y - P[i].y));
      P[i] = { x, y };
    }
    if (change < 1e-12) break;
  }
  return P;
}

export class Dxf2000 {
  constructor({ units = 'mm' } = {}) {
    this.units = units;
    this.layers = [['0', 7]];
    this.entities = [];
    this.next = 0x30; // handles below this are used by the fixed tables
  }

  handle() { return (this.next++).toString(16).toUpperCase(); }

  layer(name, color = 7) {
    const n = String(name).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    if (!this.layers.some(([l]) => l === n)) this.layers.push([n, color]);
    return n;
  }

  /** One closed, smooth spline through the points (cubic, periodic). */
  closedSpline(layer, points) {
    const P = periodicCubicControlPoints(points);
    const ctrl = [...P, P[0], P[1], P[2]]; // wrap 3 points: closed uniform cubic
    const knots = Array.from({ length: ctrl.length + 4 }, (_, i) => i);
    const out = ['0', 'SPLINE', '5', this.handle(), '330', '1F', '100', 'AcDbEntity', '8', this.layer(layer), '100', 'AcDbSpline',
      '210', '0.0', '220', '0.0', '230', '1.0',
      '70', '11', // closed (1) + periodic (2) + planar (8)
      '71', '3', '72', String(knots.length), '73', String(ctrl.length), '74', '0',
      '42', '0.0000001', '43', '0.0000001'];
    for (const k of knots) out.push('40', num(k));
    for (const p of ctrl) out.push('10', num(p.x), '20', num(p.y), '30', '0.0');
    this.entities.push(out);
  }

  circle(layer, c, r) {
    this.entities.push(['0', 'CIRCLE', '5', this.handle(), '330', '1F', '100', 'AcDbEntity', '8', this.layer(layer), '100', 'AcDbCircle',
      '10', num(c.x), '20', num(c.y), '30', '0.0', '40', num(r)]);
  }

  /** Arc counter-clockwise from angle a0 to a1 (radians). */
  arc(layer, c, r, a0, a1) {
    const deg = (a) => { const d = ((a * 180) / Math.PI) % 360; return d < 0 ? d + 360 : d; };
    this.entities.push(['0', 'ARC', '5', this.handle(), '330', '1F', '100', 'AcDbEntity', '8', this.layer(layer), '100', 'AcDbCircle',
      '10', num(c.x), '20', num(c.y), '30', '0.0', '40', num(r), '100', 'AcDbArc', '50', num(deg(a0)), '51', num(deg(a1))]);
  }
  line(layer, a, b) {
    this.entities.push(['0', 'LINE', '5', this.handle(), '330', '1F', '100', 'AcDbEntity', '8', this.layer(layer), '100', 'AcDbLine',
      '10', num(a.x), '20', num(a.y), '30', '0.0', '11', num(b.x), '21', num(b.y), '31', '0.0']);
  }

  toString() {
    const ins = this.units === 'in' ? '1' : '4';
    const L = [];
    const add = (...a) => L.push(...a);
    // ---- header ----
    add('0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1015',
      '9', '$HANDSEED', '5', 'FFFFF',
      '9', '$INSUNITS', '70', ins,
      '9', '$MEASUREMENT', '70', this.units === 'in' ? '0' : '1',
      '0', 'ENDSEC');
    add('0', 'SECTION', '2', 'CLASSES', '0', 'ENDSEC');
    // ---- tables (fixed handles 1–2F) ----
    add('0', 'SECTION', '2', 'TABLES');
    const table = (name, handle, count, body) => {
      add('0', 'TABLE', '2', name, '5', handle, '330', '0', '100', 'AcDbSymbolTable', '70', String(count));
      body();
      add('0', 'ENDTAB');
    };
    table('VPORT', '8', 1, () => add('0', 'VPORT', '5', '29', '330', '8', '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord',
      '2', '*ACTIVE', '70', '0', '10', '0.0', '20', '0.0', '11', '1.0', '21', '1.0', '12', '0.0', '22', '0.0', '13', '0.0', '23', '0.0',
      '14', '10.0', '24', '10.0', '15', '10.0', '25', '10.0', '16', '0.0', '26', '0.0', '36', '1.0', '17', '0.0', '27', '0.0', '37', '0.0',
      '40', '200.0', '41', '1.5', '42', '50.0', '43', '0.0', '44', '0.0', '50', '0.0', '51', '0.0',
      '71', '0', '72', '100', '73', '1', '74', '3', '75', '0', '76', '0', '77', '0', '78', '0'));
    table('LTYPE', '5', 3, () => {
      for (const [h, n, d] of [['14', 'ByBlock', ''], ['15', 'ByLayer', ''], ['16', 'Continuous', 'Solid line']]) {
        add('0', 'LTYPE', '5', h, '330', '5', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord',
          '2', n, '70', '0', '3', d, '72', '65', '73', '0', '40', '0.0');
      }
    });
    table('LAYER', '2', this.layers.length, () => {
      this.layers.forEach(([n, c], i) => add('0', 'LAYER', '5', (0x1000 + i).toString(16).toUpperCase(), '330', '2', // own range: no clash with the fixed handles
        '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '2', n, '70', '0', '62', String(c), '6', 'Continuous', '370', '-3'));
    });
    table('STYLE', '3', 1, () => add('0', 'STYLE', '5', '11', '330', '3', '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord',
      '2', 'Standard', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '2.5', '3', 'txt', '4', ''));
    table('VIEW', '6', 0, () => {});
    table('UCS', '7', 0, () => {});
    table('APPID', '9', 1, () => add('0', 'APPID', '5', '12', '330', '9', '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '2', 'ACAD', '70', '0'));
    add('0', 'TABLE', '2', 'DIMSTYLE', '5', 'A', '330', '0', '100', 'AcDbSymbolTable', '70', '1', '100', 'AcDbDimStyleTable', '71', '0');
    add('0', 'DIMSTYLE', '105', '27', '330', 'A', '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '2', 'Standard', '70', '0');
    add('0', 'ENDTAB');
    table('BLOCK_RECORD', '1', 2, () => {
      add('0', 'BLOCK_RECORD', '5', '1F', '330', '1', '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '2', '*Model_Space', '340', '0');
      add('0', 'BLOCK_RECORD', '5', '1B', '330', '1', '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '2', '*Paper_Space', '340', '0');
    });
    add('0', 'ENDSEC');
    // ---- blocks ----
    add('0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '5', '20', '330', '1F', '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockBegin', '2', '*Model_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', '*Model_Space', '1', '',
      '0', 'ENDBLK', '5', '21', '330', '1F', '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockEnd',
      '0', 'BLOCK', '5', '1C', '330', '1B', '100', 'AcDbEntity', '67', '1', '8', '0', '100', 'AcDbBlockBegin', '2', '*Paper_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', '*Paper_Space', '1', '',
      '0', 'ENDBLK', '5', '1D', '330', '1B', '100', 'AcDbEntity', '67', '1', '8', '0', '100', 'AcDbBlockEnd',
      '0', 'ENDSEC');
    // ---- entities ----
    add('0', 'SECTION', '2', 'ENTITIES');
    for (const e of this.entities) add(...e);
    add('0', 'ENDSEC');
    // ---- objects: the root dictionary and the (empty) group dictionary ----
    add('0', 'SECTION', '2', 'OBJECTS',
      '0', 'DICTIONARY', '5', 'C', '330', '0', '100', 'AcDbDictionary', '281', '1', '3', 'ACAD_GROUP', '350', 'D',
      '0', 'DICTIONARY', '5', 'D', '330', 'C', '100', 'AcDbDictionary', '281', '1',
      '0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n') + '\r\n';
  }
}
