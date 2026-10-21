// =============================================================================
// main.js — LinkLab start-up
// =============================================================================

import { App } from './app.js';
import { createUI } from './ui/ui.js';

const $ = (id) => document.getElementById(id);

const ui = createUI({
  topbar: $('topbar'), toolbar: $('toolbar'), sidebar: $('sidebar'),
  timeline: $('timeline'), plots: $('plots'), stage: $('stage'),
  hint: $('hint'), coords: $('coords'), toast: $('toast'),
});
const app = new App({ canvas: $('canvas'), ui });
ui.attach(app);
app.restoreAutosave();
app.requestRender();

// handy for debugging from the browser console
window.linklab = app;
