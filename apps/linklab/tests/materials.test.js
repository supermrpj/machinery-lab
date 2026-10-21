// Materials: the 3-D printing plastics and a typed (custom) density.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addJoint, addLink } from '../src/model/document.js';
import { ownMassProps, densityOf, materialName, MATERIALS } from '../src/model/mass.js';

function bar(dynamics) {
  const doc = createDocument();
  const a = addJoint(doc, 0, 0), b = addJoint(doc, 100, 0);
  const L = addLink(doc, [a.id, b.id]);
  doc.dynamics = dynamics;
  return ownMassProps(doc, L).m;
}

test('mass scales with the density of the chosen material', () => {
  const steel = bar({ material: 'steel' });
  for (const k of ['pla', 'abs', 'petg', 'asa', 'pc', 'nylon']) {
    const m = bar({ material: k });
    assert.ok(Math.abs(m / steel - MATERIALS[k].rho / 7850) < 1e-12, k);
  }
  assert.equal(densityOf({ material: 'abs' }), 1040);
});

test('custom density', () => {
  const steel = bar({ material: 'steel' });
  assert.ok(Math.abs(bar({ material: 'custom', rho: 785 }) / steel - 0.1) < 1e-12);
  assert.equal(densityOf({ material: 'custom' }), 1000); // nothing typed yet: the default
  assert.equal(materialName({ material: 'custom', rho: 900 }), 'material of 900 kg/m³');
  assert.equal(materialName({ material: 'pla' }), 'PLA');
  assert.equal(materialName({ material: 'steel' }), 'steel');
});
