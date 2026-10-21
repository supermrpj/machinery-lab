import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dxf } from '../src/dxf.js';
import { makeZip, crc32 } from '../src/zip.js';
import { linkOutline } from '../src/outline.js';

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('zip has the right signatures and entry count', () => {
  const z = makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b.dxf', data: '0\r\nEOF\r\n' }]);
  const v = new DataView(z.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
});

/** The outline must be one closed loop: each line ends where the next arc starts. */
function assertClosedProfile(o) {
  const at = (a, deg) => ({ x: a.c.x + a.r * Math.cos((deg * Math.PI) / 180), y: a.c.y + a.r * Math.sin((deg * Math.PI) / 180) });
  for (let i = 0; i < o.lines.length; i++) {
    const s = at(o.arcs[i], o.arcs[i].start), e = at(o.arcs[i], o.arcs[i].end);
    const l = o.lines[i], next = o.lines[(i + 1) % o.lines.length];
    assert.ok(Math.hypot(l.b.x - s.x, l.b.y - s.y) < 1e-9, 'line → arc gap');
    assert.ok(Math.hypot(next.a.x - e.x, next.a.y - e.y) < 1e-9, 'arc → line gap');
  }
}

test('link outline: a two-joint slot and a three-joint plate are closed profiles', () => {
  const slot = linkOutline([{ x: 0, y: 0 }, { x: 40, y: 0 }], 6);
  assert.equal(slot.lines.length, 2);
  assert.equal(slot.arcs.length, 2);
  assertClosedProfile(slot);
  const plate = linkOutline([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 60, y: 42 }], 6);
  assert.equal(plate.lines.length, 3);
  assertClosedProfile(plate);
  // collinear joints still give a slot
  assert.equal(linkOutline([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 50, y: 0 }], 5).lines.length, 2);
});

test('DXF: R12 header, layer table and entities are well formed', () => {
  const d = new Dxf();
  d.layer('Links', 7);
  d.line('Links', { x: 0, y: 0 }, { x: 10, y: 0 });
  d.circle('Pin holes', { x: 0, y: 0 }, 3);
  d.arc('Links', { x: 0, y: 0 }, 5, 90, 270);
  d.text('Notes', { x: 0, y: -5 }, 2.5, 'Link 2 — θ₂'); // non-ASCII is removed
  const s = d.toString();
  const lines = s.split('\r\n');
  assert.equal(lines[lines.length - 2], 'EOF');
  assert.ok(s.includes('AC1009'));
  assert.ok(s.includes('\r\nLINKS\r\n') && s.includes('PIN_HOLES') && s.includes('NOTES'));
  assert.ok(!/[^\x00-\x7F]/.test(s), 'output must be ASCII');
  // group codes and values alternate
  for (let i = 0; i < lines.length - 1; i += 2) assert.ok(/^\s*-?\d+$/.test(lines[i]), `bad group code at line ${i}: ${lines[i]}`);
});
