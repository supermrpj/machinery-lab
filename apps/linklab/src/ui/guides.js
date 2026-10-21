// =============================================================================
// guides.js — the short guide card shown the first time a tool is used
// -----------------------------------------------------------------------------
// A card in the top-left corner of the drawing: a looping animation of the
// clicks (from guide-demos.js), the steps in words, and one tip. It appears
// once per tool, can be reopened with the “Guide” button next to the hint, and
// can be switched off or reset from Help.
// =============================================================================

import { h } from '../../../../packages/ui-kit/src/dom.js';
import { safeStorage } from '../../../../packages/ui-kit/src/files.js';
import { DEMOS, DEMO_W, DEMO_H } from './guide-demos.js';

const STORE_KEY = 'linklab.guides';

/** Steps for each tool, in the order the student clicks. */
export const GUIDES = {
  select: {
    steps: ['Click anything to select it and see it in Properties.', 'Drag a joint to change the design.', 'Drag a link to move the mechanism by hand.', 'Drag empty space to pan.'],
    tip: 'Click the padlock below the drawing to lock all lengths, so a stray drag can never change the design.',
  },
  drive: {
    steps: ['Draw or open a mechanism.', 'Drag any link or joint: the mechanism moves as if you pushed it.'],
    tip: 'This tool never changes lengths, so it is the safe way to try a design.',
  },
  point: { steps: ['Click to place a construction point. It snaps to ends, centres and intersections.'] },
  segment: { steps: ['Click the first end.', 'Click the second end.'], tip: 'Hold Shift for 15° steps.' },
  xline: { steps: ['Click a point the line passes through.', 'Click a second point to set its direction.'], tip: 'Construction lines run off the sheet in both directions.' },
  measure: { steps: ['Click the first point.', 'Click the second point. The distance stays on the sheet as a dimension.'] },
  eraser: {
    steps: ['Click a point, line, arc, circle or dimension to delete it.', 'Or press and drag across several: one drag is one undo step.'],
    tip: 'The eraser only removes drawings. To delete part of the mechanism, select it and press Delete.',
  },
  compass: {
    steps: ['Drag the needle (or click) to put it on the centre.', 'Drag the pencil tip to open the compass to the radius you want.', 'Drag the knob on top round to draw the arc.'],
    tip: 'Open the compass on two points (the needle on one, the pencil on the other) to copy a length exactly.',
  },
  protractor: {
    steps: ['Drag the centre onto the vertex.', 'Drag the round grip to line the baseline up.', 'Click to draw a line at the angle you read, or Alt + click to mark a point.'],
  },
  ground: { steps: ['Click where the mechanism is fixed to the frame.'], tip: 'Click an existing joint to pin it to the ground, or click again to free it.' },
  link: {
    steps: ['Click a ground pivot or joint to start.', 'Click the other end — an existing joint, or empty space for a new one.', 'Keep clicking to chain links; Esc or right-click to stop.'],
    tip: 'Ending a link on the body of another link pins it there. The first link turning about a ground pivot becomes the input (link 2).',
  },
  coupler: {
    steps: ['Click on or near a link to add a point that moves with it.', 'Run the mechanism: the point’s path (the coupler curve) is traced.'],
    tip: 'Click a joint that lies on another link to pin it to that link.',
  },
  slider: {
    steps: ['Click the joint that should slide.', 'Click what it slides along — a line or a link — or click two points for a new fixed rail.'],
    tip: 'Slider-crank: the joint at the end of the rod. Inverted slider-crank: the pivot the link passes through.',
  },
  wheel: {
    steps: ['Click the centre: a ground pivot (fixed wheel), a joint (planet on an arm), or empty space.', 'Click to set the radius — click the point it should touch.'],
    tip: 'A wheel on its own does nothing: join it to another wheel or a line with a Roll joint.',
  },
  prismatic: {
    steps: ['Click the link that slides (the rod or block).', 'Click the link it slides in (the cylinder), or empty space to slide on the ground.', 'Click a line, two points, or press Enter to slide along the link’s centre line.'],
  },
  roll: {
    steps: ['Click the first rolling shape: a wheel, a circle, a construction line or a link.', 'Click the shape it rolls on.', 'Run the mechanism: the two turn together with no slipping.'],
    tip: 'Use it for friction wheels, gear pitch circles, and a wheel rolling on the ground (a line). The shapes must already touch.',
  },
  rollslide: {
    steps: ['Click the first shape (for example the cam disc).', 'Click the shape it touches (for example the follower face, a line).', 'Run it: they stay in contact but may slide over each other.'],
    tip: 'This is a half joint: it removes one freedom, where a Roll joint removes two. Use it for cams and real gear teeth.',
  },
  actuator: {
    steps: ['Click where the cylinder is mounted — a joint, or empty space for a fixed mount.', 'Click the joint the rod end pushes.', 'It becomes the input: ▶ extends and retracts it between its limits.'],
    tip: 'Set the shortest and longest lengths in Properties. Choose a different input there at any time.',
  },
  input: {
    steps: ['Click a pivot or a link: the motor goes on that pin (if several links meet there, choose which one it turns).', 'Or click a linear actuator or a slider to drive the mechanism with it.', 'Press Enter or ▶ to run it.'],
    tip: 'Add a cylinder first with Linear actuator (U). Right-click any part for the same choice.',
  },
  masses: {
    title: 'Masses and centres of mass',
    steps: [
      'Each link’s mass comes from its shape, in the material and thickness × width set in the Forces panel. For an odd-shaped link, draw its outline on it with Outline (B).',
      'To type your own, right-click the link and choose Mass and centre of mass… (or click its row in the Masses table, or Edit mass… in Properties).',
      'Choose Typed values and enter m and I_G about the centre of mass (in the units chosen in the Units menu, top bar).',
      'Give the centre of mass G in the link’s own frame: from one of its joints, along the line to another. Type r and θ, or x′ and y′, or pick G on the drawing.',
      'Press Apply. G stays on the link when it moves or its lengths change; the ◐ mark shows where it is.',
    ],
    tip: 'θ is counter-clockwise from the line of centres. For a textbook problem in US units, choose “US (in)” in the Units menu (top bar) and type the values as given (blob = lb·s²/in). A weight W gives m = W / g.',
  },
  load: {
    steps: ['Click a link where a force acts; drag while pressing to point it.', 'Set its size, direction and how it changes over the cycle in Properties.', 'Choose Static or Dynamic in the Forces panel to see joint forces and the input torque.'],
    tip: 'Hold Shift and click to add a torque instead. Double-click (or right-click) a force or torque to edit it.',
  },
  body: { steps: ['Click corners to draw a shape, or press and drag to draw freehand.', 'Click the first corner, double-click or press Enter to close it.'], tip: 'It moves with the link it is drawn on.' },
  image: { steps: ['Paste a screenshot with Ctrl+V, or use “Load picture” in Properties.', 'Drag to move it. Then use Set scale to make it true size.'] },
  scale: { steps: ['Click one end of a length you know on the picture.', 'Click the other end.', 'Type the real length (in the unit chosen in the Units menu, top bar).'] },
};

function loadState() {
  try { const s = JSON.parse(safeStorage.get(STORE_KEY) || '{}'); return { off: !!s.off, seen: Array.isArray(s.seen) ? s.seen : [] }; }
  catch { return { off: false, seen: [] }; }
}

const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function createGuides(stage, app) {
  const state = loadState();
  const save = () => safeStorage.set(STORE_KEY, JSON.stringify(state));
  let card = null, raf = 0, shownId = null;

  function close() {
    cancelAnimationFrame(raf); raf = 0;
    if (card) card.remove();
    card = null; shownId = null;
  }

  function animate(canvas, demo) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = DEMO_W * dpr; canvas.height = DEMO_H * dpr;
    const ctx = canvas.getContext('2d');
    const frame = (t) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); demo.draw(ctx, t % demo.period); };
    if (reduceMotion()) {
      // a still of the result; click the picture to play it once
      frame(demo.period - 0.05);
      canvas.title = 'Click to play';
      canvas.onclick = () => {
        const t0 = performance.now();
        const once = (now) => { const t = (now - t0) / 1000; frame(Math.min(t, demo.period - 0.05)); if (t < demo.period) raf = requestAnimationFrame(once); };
        cancelAnimationFrame(raf); raf = requestAnimationFrame(once);
      };
      return;
    }
    const t0 = performance.now();
    const loop = (now) => { frame((now - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }

  const guides = {
    has: (id) => !!GUIDES[id],
    get off() { return state.off; },
    setOff(off) { state.off = !!off; save(); },
    reset() { state.seen = []; state.off = false; save(); },
    isOpen: () => !!card,

    /** Show the guide for a tool (whether or not it was seen before). */
    open(id) {
      const g = GUIDES[id];
      // a tool's guide, or a topic guide with its own title (e.g. masses)
      const tool = app.tools.find((t) => t.id === id) || (g && g.title ? { id, label: g.title } : null);
      if (!g || !tool) return;
      close();
      shownId = id;
      if (!state.seen.includes(id)) { state.seen.push(id); save(); }
      const demo = DEMOS[id];
      const canvas = demo ? h('canvas', { class: 'guide-demo', style: { width: `${DEMO_W}px`, height: `${DEMO_H}px` }, role: 'img', 'aria-label': `Animation: how to use ${tool.label}` }) : null;
      const off = h('input', { type: 'checkbox', checked: !state.off, onchange: (e) => guides.setOff(!e.target.checked) });
      card = h('section', { class: 'guide', role: 'dialog', 'aria-label': `${tool.label} guide` },
        h('header', {},
          h('h3', {}, tool.label),
          tool.shortcut ? h('kbd', {}, tool.shortcut) : null,
          h('button', { class: 'guide-x', title: 'Close', 'aria-label': 'Close guide', onclick: close }, '×')),
        canvas,
        h('ol', {}, g.steps.map((s) => h('li', {}, s))),
        g.tip ? h('p', { class: 'guide-tip' }, g.tip) : null,
        h('footer', {},
          h('label', { class: 'check' }, off, ' Show a guide for each new tool'),
          h('button', { class: 'btn primary', onclick: close }, 'Got it')));
      card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); e.stopPropagation(); } });
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      stage.append(card);
      if (canvas) animate(canvas, demo);
    },

    close,

    /** Show a topic guide the first time it is relevant (unless guides are off). */
    topic(id) {
      if (state.off || !GUIDES[id] || state.seen.includes(id)) return;
      guides.open(id);
    },

    /** Called by the app whenever the tool changes. */
    toolActivated(tool) {
      if (card && shownId !== tool.id) close();
      if (state.off || !GUIDES[tool.id] || state.seen.includes(tool.id)) return;
      if (tool.id === 'select') { state.seen.push('select'); save(); return; } // the default tool: don't greet with a card
      guides.open(tool.id);
    },
  };
  return guides;
}
