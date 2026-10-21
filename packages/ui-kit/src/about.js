// =============================================================================
// about.js — the About box shared by the apps: credit, licence and links
// -----------------------------------------------------------------------------
// NOTICE.md (GPL-3.0 section 7) asks every copy and modified version to keep
// the credit line and the link to the original source. Keep both here.
// The build passes the licence texts and the links in __BUILD_INFO__; while
// developing they are empty and the box says where to find them.
// =============================================================================

import { h } from './dom.js';

// ---- CONFIG -------------------------------------------------------------------
export const CREDIT = 'LinkLab and CamLab were created by Maroay P.';
export const COPYRIGHT = 'Copyright © 2026 Maroay P';
// -------------------------------------------------------------------------------

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

/**
 * Content for the About dialog.
 * @param {object} o
 * @param {string} o.name      app name
 * @param {string} o.summary   one line after the version
 * @param {object} o.info      __BUILD_INFO__: version, date, licence, notice, notices, links
 */
export function aboutContent({ name, summary, info }) {
  const links = info.links || {};
  const linkRow = [
    links.site && link(links.site, 'Website'),
    links.source && link(links.source, 'Source code on GitHub'),
    links.sponsor && link(links.sponsor, 'Support this work (GitHub Sponsors)'),
  ].filter(Boolean);
  const block = (title, text, fallback) => h('details', {}, h('summary', {}, title), h('pre', {}, text || fallback));
  return [
    h('p', {}, h('b', {}, `${name} ${info.version}`), ` (${info.date}) — ${summary}`),
    h('p', {}, CREDIT, ' ', COPYRIGHT, '.'),
    h('p', {}, 'Free software under the GNU General Public License, version 3: you may use, share and change it under its terms. It comes with no warranty.'),
    h('p', { class: 'note' }, 'This is a teaching aid. Check important results independently before using them to design a real machine.'),
    linkRow.length ? h('p', { class: 'about-links' }, linkRow.flatMap((a, i) => (i ? [' · ', a] : [a]))) : null,
    block('Notice and additional terms', info.notice, 'See NOTICE.md.'),
    block('GNU General Public License v3', info.licence, 'See the LICENSE file.'),
    block('Third-party software', info.notices, 'See THIRD_PARTY_NOTICES.md.'),
  ];
}
