// Filmkväll – ui.js
// All DOM-logik och användarinteraktion

import { apiCall } from './api.js';
import { Cache, SaveQueue, scheduleFlush, pendingCount, NightSaveGuard } from './state.js';

const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];

export function initUI(){
  initStaticUI();
  bindEvents();
  loadInitial();
}

function initStaticUI(){
  // Användarlista
  const whoSel = document.getElementById('who');
  whoSel.innerHTML = PEOPLE.map(p=>`<option value="${p}">${p}</option>`).join('');

  const savedWho = localStorage.getItem('film_who');
  if (savedWho && PEOPLE.includes(savedWho)) whoSel.value = savedWho;

  document.getElementById('theme').value = localStorage.getItem('film_theme') || 'auto';
  applyTheme();
}

function bindEvents(){
  document.getElementById('who').addEventListener('change', e=>{
    localStorage.setItem('film_who', e.target.value);
    loadWishlist();
  });

  document.getElementById('theme').addEventListener('change', e=>{
    localStorage.setItem('film_theme', e.target.value);
    applyTheme();
  });

  document.getElementById('saveList').onclick = saveWishlist;
  document.getElementById('loadList').onclick = loadWishlist;
  document.getElementById('saveNight').onclick = saveNight;
}

async function loadInitial(){
  setStatus(true,'Laddar…');
  try{
    await loadCurrent();
    await loadWishlist();
    await loadHistory();
    setStatus(true,'Redo');
  }catch(e){
    setStatus(false, e.message);
  }
}

async function loadCurrent(){
  const j = await apiCall('getCurrent');
  document.getElementById('nextName').value = j.next || '';
  document.getElementById('suggested').value = j.suggestion || '';
}

async function loadWishlist(){
  const who = document.getElementById('who').value;
  const j = await apiCall('getWishlist',{ person: who });

  const col = document.getElementById('wishlistCol');
  col.innerHTML = '';

  ['R1','R2','R3','R4','R5'].forEach((k,i)=>{
    const inp = document.createElement('input');
    inp.value = j[k] || '';
    inp.placeholder = `#${i+1}`;
    inp.addEventListener('change', ()=>autoSaveWishlist());
    col.appendChild(inp);
  });
}

function autoSaveWishlist(){
  scheduleFlush(sendWishlist, 1200);
}

async function sendWishlist(){
  const who = document.getElementById('who').value;
  const vals = Array.from(document.querySelectorAll('#wishlistCol input')).map(i=>i.value);
  await apiCall('saveWishlist',{
    person: who,
    R1: vals[0], R2: vals[1], R3: vals[2], R4: vals[3], R5: vals[4]
  });
}

async function saveWishlist(){
  try{
    await sendWishlist();
    setStatus(true,'Lista sparad');
  }catch(e){ setStatus(false,e.message); }
}

async function saveNight(){
  const who = document.getElementById('nextName').value;
  const film = document.getElementById('suggested').value;
  const comment = document.getElementById('comment').value;

  if(!who || !film){
    setStatus(false,'Saknar vem eller film');
    return;
  }

  const snap = NightSaveGuard.snapshot({ who, film, comment, scores:{} });
  if (NightSaveGuard.shouldBlock(snap)){
    setStatus(true,'Redan sparad');
    return;
  }

  await apiCall('saveNight',{ who, film, comment });
  NightSaveGuard.markSaved(snap);

  document.getElementById('comment').value = '';
  await loadCurrent();
  setStatus(true,'Kväll sparad');
}

async function loadHistory(){
  const j = await apiCall('getHistory',{ limit:10 });
  const box = document.getElementById('history');
  box.innerHTML = j.rows.map(r=>
    `<div class="pill"><strong>${r.Film}</strong> – ${r.Datum}</div>`
  ).join('');
}

function setStatus(ok,msg){
  const el = document.getElementById('apiStatus');
  el.textContent = msg;
  el.className = 'pill ' + (ok?'ok':'err');
}

function applyTheme(){
  const sel = document.getElementById('theme').value;
  const root = document.documentElement;
  let mode = sel;
  if (sel === 'auto'){
    mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (mode === 'light') root.setAttribute('data-theme','light');
  else root.removeAttribute('data-theme');
}
// ===== Filmkväll: inbyggd felsökning (iPad-friendly) =====
(function initDebugPanel(){
  function safeJson(x){
    try { return JSON.stringify(x, null, 2); } catch { return String(x); }
  }

  function ensurePanel(){
    const statusEl = document.getElementById('apiStatus');
    if(!statusEl) return null;

    // Lägg panelen i samma "Status"-kort (under pillen)
    const card = statusEl.closest('.card') || statusEl.parentElement;
    if(!card) return null;

    if(document.getElementById('debugPanel')) return document.getElementById('debugPanel');

    const wrap = document.createElement('details');
    wrap.id = 'debugPanel';
    wrap.style.marginTop = '10px';

    const sum = document.createElement('summary');
    sum.textContent = 'Felsök (visa teknisk info)';
    sum.className = 'muted';
    wrap.appendChild(sum);

    const pre = document.createElement('pre');
    pre.id = 'debugPre';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.margin = '10px 0 0';
    pre.style.padding = '10px';
    pre.style.border = '1px solid var(--border)';
    pre.style.borderRadius = '10px';
    pre.style.background = 'var(--input)';
    pre.textContent = 'Ingen debug-data ännu.';
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost';
    btn.textContent = 'Kopiera felsökning';
    btn.style.marginTop = '8px';
    btn.addEventListener('click', async ()=>{
      const txt = pre.textContent || '';
      try{
        await navigator.clipboard.writeText(txt);
        statusEl.classList.add('flash');
        setTimeout(()=>statusEl.classList.remove('flash'), 800);
      }catch{
        // fallback: markera text
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    });
    wrap.appendChild(btn);

    card.appendChild(wrap);
    return wrap;
  }

  function render(){
    const panel = ensurePanel();
    if(!panel) return;
    const pre = document.getElementById('debugPre');
    if(!pre) return;

    const d = window.__FILMKVALL_DEBUG__;
    if(!d){
      pre.textContent = 'Ingen debug-data ännu.\n(Om detta står kvar efter "Load failed" så har api.js inte hunnit skicka debug-info ännu.)';
      return;
    }
    pre.textContent = safeJson(d);
  }

  // Uppdatera vid load + när api.js triggar event
  window.addEventListener('filmkvall:debug', render);
  window.addEventListener('load', render);
  setTimeout(render, 500);
})();
