// =============================================================================
// main.js — CamLab start-up
// =============================================================================

import { App } from './app.js';
import { createUI } from './ui/ui.js';

const $ = (id) => document.getElementById(id);

const ui = createUI({
  topbar: $('topbar'), inputs: $('inputs'), stage: $('stage'), stagebar: $('stagebar'), view: $('view'),
  results: $('results'), timeline: $('timeline'), toast: $('toast'),
});
const app = new App(ui);
app.restoreAutosave();
ui.attach(app);

// handy for checking from the browser console
window.camlab = app;
