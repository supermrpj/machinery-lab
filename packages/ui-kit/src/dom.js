// =============================================================================
// dom.js — tiny helpers for building the interface without a framework
// =============================================================================

/**
 * Create an element:  h('button', { class: 'tool', onclick: fn }, 'Label')
 * Attributes starting with "on" become event listeners; `style` may be an
 * object; children may be strings, nodes, arrays or null.
 */
export function h(tag, attrs = {}, ...children) {
  const el = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'line' || tag === 'rect' || tag === 'polyline' || tag === 'g'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string' && !(el instanceof SVGElement)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Remove all children and add new ones. */
export function replaceChildren(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, children);
}

/** Build an inline SVG icon from a path string (24×24 viewBox, stroked). */
export function icon(d, size = 20) {
  const s = h('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = d;
  return s;
}
