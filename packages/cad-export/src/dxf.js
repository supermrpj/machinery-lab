// =============================================================================
// dxf.js — a small DXF writer (AutoCAD R12 / AC1009, ASCII)
// -----------------------------------------------------------------------------
// R12 is the most widely readable DXF version: SolidWorks, Autodesk Inventor,
// Fusion 360, AutoCAD, LibreCAD, laser cutters and CNC software all open it.
// Units are millimetres. Angles for arcs are in degrees, counter-clockwise.
//
//   const d = new Dxf();
//   d.layer('OUTLINE', 7);
//   d.line('OUTLINE', a, b);  d.circle('HOLES', c, r);  d.arc(...)
//   const text = d.toString();
// =============================================================================

/** AutoCAD colour numbers (ACI) for readable layer colours. */
export const ACI = { red: 1, yellow: 2, green: 3, cyan: 4, blue: 5, magenta: 6, white: 7, grey: 8 };

const num = (v) => {
  if (!Number.isFinite(v)) return '0.0';
  const s = (Math.abs(v) < 1e-12 ? 0 : v).toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s;
};

/** DXF R12 text must be plain ASCII. */
const ascii = (s) => String(s).normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 250);

export class Dxf {
  constructor() {
    this.layers = new Map([['0', ACI.white]]);
    this.out = [];
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
  }

  /** Declare a layer (names: letters, digits, _ and -). */
  layer(name, color = ACI.white) {
    this.layers.set(this._name(name), color);
    return this;
  }

  _name(name) { return ascii(name).toUpperCase().replace(/[^A-Z0-9_-]/g, '_') || '0'; }

  _grow(p, r = 0) {
    this.min.x = Math.min(this.min.x, p.x - r); this.min.y = Math.min(this.min.y, p.y - r);
    this.max.x = Math.max(this.max.x, p.x + r); this.max.y = Math.max(this.max.y, p.y + r);
  }

  _put(...pairs) { for (let i = 0; i < pairs.length; i += 2) this.out.push(String(pairs[i]), String(pairs[i + 1])); }

  _layerOf(name) {
    const n = this._name(name);
    if (!this.layers.has(n)) this.layers.set(n, ACI.white);
    return n;
  }

  line(layer, a, b) {
    this._put(0, 'LINE', 8, this._layerOf(layer), 10, num(a.x), 20, num(a.y), 30, '0.0', 11, num(b.x), 21, num(b.y), 31, '0.0');
    this._grow(a); this._grow(b);
    return this;
  }

  circle(layer, c, r) {
    this._put(0, 'CIRCLE', 8, this._layerOf(layer), 10, num(c.x), 20, num(c.y), 30, '0.0', 40, num(r));
    this._grow(c, r);
    return this;
  }

  /** Arc from startDeg to endDeg, counter-clockwise. */
  arc(layer, c, r, startDeg, endDeg) {
    const w = (d) => ((d % 360) + 360) % 360;
    this._put(0, 'ARC', 8, this._layerOf(layer), 10, num(c.x), 20, num(c.y), 30, '0.0', 40, num(r), 50, num(w(startDeg)), 51, num(w(endDeg)));
    this._grow(c, r);
    return this;
  }

  /** Polyline through points (closed = joins the last point to the first). */
  polyline(layer, pts, closed = false) {
    if (pts.length < 2) return this;
    const L = this._layerOf(layer);
    this._put(0, 'POLYLINE', 8, L, 66, 1, 70, closed ? 1 : 0, 10, '0.0', 20, '0.0', 30, '0.0');
    for (const p of pts) { this._put(0, 'VERTEX', 8, L, 10, num(p.x), 20, num(p.y), 30, '0.0'); this._grow(p); }
    this._put(0, 'SEQEND', 8, L);
    return this;
  }

  point(layer, p) {
    this._put(0, 'POINT', 8, this._layerOf(layer), 10, num(p.x), 20, num(p.y), 30, '0.0');
    this._grow(p);
    return this;
  }

  text(layer, p, height, str) {
    this._put(0, 'TEXT', 8, this._layerOf(layer), 10, num(p.x), 20, num(p.y), 30, '0.0', 40, num(height), 1, ascii(str));
    this._grow(p);
    return this;
  }

  toString() {
    const o = [];
    const put = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) o.push(String(pairs[i]), String(pairs[i + 1])); };
    const has = Number.isFinite(this.min.x);
    // header: version, units (mm), drawing extents
    put(0, 'SECTION', 2, 'HEADER');
    put(9, '$ACADVER', 1, 'AC1009');
    put(9, '$INSUNITS', 70, 4);
    put(9, '$EXTMIN', 10, num(has ? this.min.x : 0), 20, num(has ? this.min.y : 0), 30, '0.0');
    put(9, '$EXTMAX', 10, num(has ? this.max.x : 0), 20, num(has ? this.max.y : 0), 30, '0.0');
    put(0, 'ENDSEC');
    // tables: one continuous line type and the layers
    put(0, 'SECTION', 2, 'TABLES');
    put(0, 'TABLE', 2, 'LTYPE', 70, 1);
    put(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, '0.0');
    put(0, 'ENDTAB');
    put(0, 'TABLE', 2, 'LAYER', 70, this.layers.size);
    for (const [name, color] of this.layers) put(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS');
    put(0, 'ENDTAB');
    put(0, 'ENDSEC');
    put(0, 'SECTION', 2, 'ENTITIES');
    o.push(...this.out);
    put(0, 'ENDSEC');
    put(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
}
