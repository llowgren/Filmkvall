// Filmkväll – ui.js
// All DOM-logik och användarinteraktion

import { apiCall } from './api.js';
import { NightSaveGuard } from './state.js';

const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];

export function initUI(){
  initStaticUI();
  bindEvents();
  loadInitial();
}

function initStaticUI(){
  // Användarlista
  const whoSel = document.getElementById('who');
  if (whoSel){
    whoSel.innerHTML = PEOPLE.map(p=>`<option value="${p}">${p}</option>`).join('');

    const savedWho = localStorage.getItem('film_who');
    if (savedWho && PEOPLE.includes(savedWho)) whoSel.value = savedWho;
  }

  const themeSel = document.getElementById('theme');
  if (themeSel){
    themeSel.value = localStorage.getItem('film_theme') || 'auto';
  }

  applyTheme();
}

function bindEvents(){
  document.getElementById('who')?.addEventListener('change', e=>{
    localStorage.setItem('film_who', e.target.value);
    loadWishlist().catch(err=>setStatus(false, err.message || String(err)));
  });

  document.getElementById('theme')?.addEventListener('change', e=>{
    localStorage.setItem('film_theme', e.target.value);
    applyTheme();
  });

  document.getElementById('saveList')?.addEventListener('click', ()=>saveWishlist());
  document.getElementById('loadList')?.addEventListener('click', ()=>loadWishlist());
  document.getElementById('saveNight')?.addEventListener('click', ()=>saveNight());
}

async function loadInitial(){
  setStatus(true,'Laddar…');
  try{
    await loadCurrent();
    await loadWishlist();
    await loadHistory();
    setStatus(true,'Redo');
  }catch(e){
    setStatus(false, e?.message || String(e));
  }
}

async function loadCurrent(){
  const j = await apiCall('getCurrent');
  document.getElementById('nextName').value = j.next || '';
  const suggested = document.getElementById('suggested');
  if (suggested){
    suggested.value = j.suggestion || '';
    // Om listan är tom: låt användaren skriva film manuellt
    suggested.readOnly = !!(j.suggestion && String(j.suggestion).trim().length);
  }

  // (Valfritt) rendera poäng-rad om backend skickar scores
  renderScoresRow(j.scores || {});
}

function renderScoresRow(scores){
  const row = document.getElementById('scoresRow');
  if(!row) return;

  // Bygg en enkel select per person (1–10) + ”–”
  row.innerHTML = '';
  for(const p of PEOPLE){
    const wrap = document.createElement('div');
    wrap.className = 'score-col';

    const lab = document.createElement('label');
    lab.textContent = p;
    wrap.appendChild(lab);

    const sel = document.createElement('select');
    sel.className = 'score-select';
    sel.id = `s-${p}`;

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '–';
    sel.appendChild(opt0);

    for(let i=1;i<=10;i++){
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      sel.appendChild(o);
    }

    // Fyll från server
    const v = (scores && (p in scores)) ? String(scores[p] ?? '').trim() : '';
    sel.value = v;

    // Spara direkt vid ändring
    sel.addEventListener('change', async ()=>{
      try{
        await apiCall('saveScores', { scores: JSON.stringify({ [p]: sel.value }) });
        setStatus(true, `Poäng sparad (${p})`);
      }catch(e){
        setStatus(false, e?.message || String(e));
      }
    });

    wrap.appendChild(sel);
    row.appendChild(wrap);
  }
}

async function loadWishlist(){
  const who = document.getElementById('who')?.value;
  if(!who) return;

  const j = await apiCall('getWishlist', { person: who });

  const col = document.getElementById('wishlistCol');
  if(!col) return;
  col.innerHTML = '';

  ['R1','R2','R3','R4','R5'].forEach((k,i)=>{
    const inp = document.createElement('input');
    inp.value = j[k] || '';
    inp.placeholder = `#${i+1}`;
    inp.addEventListener('input', ()=>scheduleWishlistAutoSave());
    inp.addEventListener('blur', ()=>scheduleWishlistAutoSave(true));
    col.appendChild(inp);
  });
}

let wishlistTimer = null;
function scheduleWishlistAutoSave(force=false){
  clearTimeout(wishlistTimer);
  wishlistTimer = setTimeout(()=>{
    sendWishlist().catch(err=>setStatus(false, err?.message || String(err)));
  }, force ? 100 : 900);
}

async function sendWishlist(){
  const who = document.getElementById('who')?.value;
  if(!who) return;

  const vals = Array.from(document.querySelectorAll('#wishlistCol input')).map(i=>i.value);
  await apiCall('saveWishlist', {
    person: who,
    R1: vals[0] || '',
    R2: vals[1] || '',
    R3: vals[2] || '',
    R4: vals[3] || '',
    R5: vals[4] || ''
  });
  setStatus(true,'Lista sparad');
}

async function saveWishlist(){
  try{
    await sendWishlist();
  }catch(e){
    setStatus(false, e?.message || String(e));
  }
}

async function saveNight(){
  const who = (document.getElementById('nextName')?.value || '').trim();
  const film = (document.getElementById('suggested')?.value || '').trim();
  const comment = (document.getElementById('comment')?.value || '').trim();

  if(!who || !film){
    setStatus(false,'Saknar vem eller film');
    return;
  }

  // Ta med scores om de finns (för guard)
  const scores = {};
  for(const p of PEOPLE){
    scores[p] = (document.getElementById(`s-${p}`)?.value || '').trim();
  }

  const snap = NightSaveGuard.snapshot({ who, film, comment, scores });
  if (NightSaveGuard.shouldBlock(snap)){
    setStatus(true,'Redan sparad');
    return;
  }

  try{
    await apiCall('saveNight', { who, film, comment });
    NightSaveGuard.markSaved(snap);

    if (document.getElementById('comment')) document.getElementById('comment').value = '';

    await loadCurrent();
    await loadHistory();
    setStatus(true,'Kväll sparad');
  }catch(e){
    setStatus(false, e?.message || String(e));
  }
}

async function loadHistory(){
  const j = await apiCall('getHistory', { limit: 10 });
  const box = document.getElementById('history');
  if(!box) return;
  box.innerHTML = (j.rows || []).map(r=>
    `<div class="pill" style="display:block;margin:6px 0;padding:10px 12px"><strong>${escapeHtml(r.Film||'')}</strong> – ${escapeHtml(r.Datum||'')}</div>`
  ).join('') || '<div class="muted">Tomt.</div>';
}

function setStatus(ok,msg){
  const el = document.getElementById('apiStatus');
  if(!el) return;
  el.textContent = msg;
  el.className = 'pill ' + (ok?'ok':'err');

  // trigga debug-render (iPad-panel)
  try{ window.dispatchEvent(new Event('filmkvall:debug')); }catch{}
}

function applyTheme(){
  const sel = document.getElementById('theme')?.value || 'auto';
  const root = document.documentElement;
  let mode = sel;
  if (sel === 'auto'){
    mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (mode === 'light') root.setAttribute('data-theme','light');
  else root.removeAttribute('data-theme');
  root.style.colorScheme = (mode === 'light') ? 'light' : 'dark';
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// ===== Filmkväll: inbyggd felsökning (iPad-friendly) =====
(function initDebugPanel(){
  function safeJson(x){
    try { return JSON.stringify(x, null, 2); } catch { return String(x); }
  }

  function ensurePanel(){
    const statusEl = document.getElementById('apiStatus');
    if(!statusEl) return null;

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

  window.addEventListener('filmkvall:debug', render);
  window.addEventListener('load', render);
  setTimeout(render, 500);
})();
