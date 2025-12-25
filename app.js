// Filmkväll – app.js
// Entry point. Ansvarar bara för att starta appen.

import { initUI } from './ui.js';

// Vänta tills DOM är redo (säkerhet)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
