/* Filmkväll – app.js
 * Entrypoint för sidan.
 */

import { applyTheme, initThemeSelect, initWhoSelect, initPendingSync } from './state.js';
import { loadAll, setStatus, PEOPLE, saveScoresPatch } from './ui.js';
import { bindAutocomplete } from './autocomplete.js';

const $ = (s)=>document.querySelector(s);

function initVersion(){
  const verEl = document.getElementById('appVersion');
  if(!verEl) return;

  try{
    const d = new Date(document.lastModified);
    if(isNaN(d)) { verEl.textContent = 'okänd'; return; }
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    verEl.textContent = `${y}-${m}-${day} ${hh}:${mm}`;
  }catch{
    verEl.textContent = 'okänd';
  }
}

function bindScoreSaves(){
  document.querySelectorAll('.score-select').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const who = sel.id.replace('s-','');
      const val = (sel.value || '').trim();
      setStatus(true, `poäng sparad för ${who} (synkar)…`);
      saveScoresPatch({ [who]: val });
    });
  });
}

(async function main(){
  initVersion();

  initThemeSelect();
  initWhoSelect(PEOPLE);
  applyTheme();

  bindScoreSaves();

  // autocomplete
  ['w1','w2','w3','w4','w5','suggested'].forEach(bindAutocomplete);

  initPendingSync();

  setStatus(true, 'Laddar…');
  await loadAll();

  // enkel refresh när man byter person
  $('#who')?.addEventListener('change', ()=>loadAll());
})();
