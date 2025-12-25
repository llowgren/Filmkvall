/* Filmkväll – app.js
 * En (1) entrypoint som gör appen fungerande utan att ha hemligheter i repo.
 * - Läser token + (valfria) API-nycklar från input-fält och sparar lokalt i localStorage
 * - Pratar med Apps Script via POST (JSON) så token inte hamnar i URL
 * - Renderar grund-UI (tur, poäng, wishlist, historik, topplistor)
 *
 * Förutsätter index.html har:
 *  - #pwInput, #who, #theme, #apiStatus
 *  - #nextName, #suggested, #comment, #saveNight
 *  - #scoresRow, #wishlistCol, #loadList, #saveList
 *  - #tops, #history
 */

// ====== KONFIG (INTE hemligheter) ======
// OBS: Detta är OK att committa – det är bara er Apps Script endpoint.
const API_BASE = 'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';
const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];

// ====== LocalStorage-nycklar ======
const LS = {
  who: 'film_who',
  theme: 'film_theme',
  token: 'film_api_token',
  tmdb: 'film_tmdb_key',
  omdb: 'film_omdb_key',
  watchmode: 'film_watchmode_key'
};

// ====== Helpers ======
const $ = (id)=>document.getElementById(id);
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function round1(x){ return Math.round((Number(x)||0)*10)/10; }

function setStatus(ok, msg){
  const el = $('apiStatus');
  if(!el) return;
  el.textContent = (ok ? 'OK – ' : 'Fel – ') + msg;
  el.className = 'pill ' + (ok ? 'ok' : 'err');
}

function getToken(){
  return String($('pwInput')?.value || localStorage.getItem(LS.token) || '').trim();
}

function saveLocalSecretsFromInputs(){
  const token = String($('pwInput')?.value || '').trim();
  if(token) localStorage.setItem(LS.token, token);

  const tmdb = String($('tmdbKeyInput')?.value || '').trim();
  const omdb = String($('omdbKeyInput')?.value || '').trim();
  const wm   = String($('watchmodeKeyInput')?.value || '').trim();
  if(tmdb) localStorage.setItem(LS.tmdb, tmdb);
  if(omdb) localStorage.setItem(LS.omdb, omdb);
  if(wm)   localStorage.setItem(LS.watchmode, wm);
}

function loadLocalSecretsToInputs(){
  const token = localStorage.getItem(LS.token) || '';
  const tmdb  = localStorage.getItem(LS.tmdb) || '';
  const omdb  = localStorage.getItem(LS.omdb) || '';
  const wm    = localStorage.getItem(LS.watchmode) || '';

  if($('pwInput')) $('pwInput').value = token;
  if($('tmdbKeyInput')) $('tmdbKeyInput').value = tmdb;
  if($('omdbKeyInput')) $('omdbKeyInput').value = omdb;
  if($('watchmodeKeyInput')) $('watchmodeKeyInput').value = wm;
}

// ====== API (POST JSON) ======
async function api(action, payload = {}){
  const token = getToken();
  const body = { action, token, ...payload };

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  // Apps Script kan ibland svara 200 med text ändå – men vi förväntar oss JSON.
  const text = await res.text();
  let j;
  try{ j = JSON.parse(text); }
  catch{ throw new Error('Ogiltigt API-svar (ej JSON)'); }

  if(!j?.ok) throw new Error(j?.error || action);
  return j;
}

// ====== UI-rendering ======
function renderPeopleSelect(){
  const sel = $('who');
  if(!sel) return;
  sel.innerHTML = PEOPLE.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

  const saved = localStorage.getItem(LS.who);
  const fallback = 'Lars';
  const initial = [saved, fallback, PEOPLE[0]].find(x=>PEOPLE.includes(x)) || PEOPLE[0];
  sel.value = initial;

  sel.addEventListener('change', ()=>{
    localStorage.setItem(LS.who, sel.value);
    loadMyList().catch(()=>{});
  });
}

function renderScoresRow(){
  const row = $('scoresRow');
  if(!row) return;
  row.innerHTML = PEOPLE.map(p=>{
    const id = `s-${p}`;
    const opts = ['<option value="">–</option>']
      .concat(Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`))
      .join('');
    return `
      <div class="score-col">
        <label for="${escapeHtml(id)}">${escapeHtml(p)}</label>
        <select id="${escapeHtml(id)}" class="score-select">${opts}</select>
      </div>
    `;
  }).join('');

  // Auto-spara poäng på change
  row.querySelectorAll('.score-select').forEach(sel=>{
    sel.addEventListener('change', async ()=>{
      const who = sel.id.replace('s-','');
      const val = (sel.value || '').trim();
      try{
        setStatus(true, `poäng sparas för ${who}…`);
        await api('saveScores', { scores: JSON.stringify({ [who]: val }) });
        setStatus(true, `poäng sparad för ${who}`);
      }catch(e){
        console.error(e);
        setStatus(false, e.message || 'saveScores');
      }
    });
  });
}

function renderWishlistInputs(){
  const box = $('wishlistCol');
  if(!box) return;

  // Bygger 5 rader med input + flytta upp/ner
  box.innerHTML = Array.from({length:5}, (_,k)=>{
    const i = k+1;
    return `
      <div class="wishlist-item" data-wi="${i}">
        <div class="lookup-wrap ac-wrap">
          <input id="w${i}" class="lookup-input" placeholder="#${i}${i===1?' – högst upp':''}" autocomplete="off" />
          <button class="lookup-btn" type="button" data-lookup="w${i}">Sök</button>
          <div class="ac-list" id="ac-w${i}" style="display:none"></div>
        </div>
        <div class="wishlist-move" aria-label="Flytta önskan">
          <button type="button" class="ghost" data-move="up" data-i="${i}" aria-label="Flytta upp" ${i===1?'disabled':''}>▲</button>
          <button type="button" class="ghost" data-move="down" data-i="${i}" aria-label="Flytta ner" ${i===5?'disabled':''}>▼</button>
        </div>
      </div>
      <div id="w${i}-info" class="omdb-info"></div>
    `;
  }).join('');

  // Flytta upp/ner
  document.addEventListener('click', (e)=>{
    const btn = e.target?.closest?.('[data-move][data-i]');
    if(!btn) return;
    const i = Number(btn.getAttribute('data-i'));
    const dir = btn.getAttribute('data-move');
    const j = dir === 'up' ? i-1 : i+1;
    if(j < 1 || j > 5) return;

    const a = $('w'+i);
    const b = $('w'+j);
    if(!a || !b) return;

    const tmp = a.value;
    a.value = b.value;
    b.value = tmp;
  }, {passive:true});
}

function applyTheme(){
  const sel = $('theme');
  const root = document.documentElement;
  let mode = sel?.value || 'auto';
  if(mode === 'auto'){
    mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if(mode === 'light') root.setAttribute('data-theme','light');
  else root.removeAttribute('data-theme');
  root.style.colorScheme = (mode === 'light') ? 'light' : 'dark';
}

function bindTheme(){
  const sel = $('theme');
  if(!sel) return;
  sel.value = localStorage.getItem(LS.theme) || 'auto';
  applyTheme();
  sel.addEventListener('change', ()=>{
    localStorage.setItem(LS.theme, sel.value);
    applyTheme();
  });

  const mql = window.matchMedia('(prefers-color-scheme: light)');
  mql.addEventListener?.('change', ()=>{ if(sel.value === 'auto') applyTheme(); });
  mql.addListener?.(()=>{ if(sel.value === 'auto') applyTheme(); });
}

// ====== Data laddning/rendering ======
async function loadCurrent(){
  const cur = await api('getCurrent', {});
  $('nextName').value = cur.next || '';

  const suggested = $('suggested');
  const serverSuggestion = (cur.suggestion || '').trim();
  if(suggested){
    suggested.value = serverSuggestion;
    // Tomt => skrivbart
    suggested.readOnly = serverSuggestion.length > 0;
  }

  // Poäng
  if(cur.scores){
    for(const p of PEOPLE){
      const el = $('s-'+p);
      if(el) el.value = cur.scores[p] ?? '';
    }
  }

  return cur;
}

async function loadMyList(){
  const who = $('who')?.value || '';
  if(!who) return;

  const j = await api('getWishlist', { person: who });
  for(let i=1;i<=5;i++){
    const el = $('w'+i);
    if(!el) continue;
    el.value = j['R'+i] || '';
  }
}

async function loadTops(){
  const tops = await api('getTops', { limit: 5 });
  const films = (tops.bestFilms||[]).map(x=>
    `<div class="pill">${escapeHtml(x.film)} — <strong>${escapeHtml(x.avg)}</strong> <span class="muted">(${escapeHtml(x.who)})</span></div>`
  ).join('') || '–';

  const pickers = (tops.bestPickers||[]).map(x=>
    `<div class="pill">${escapeHtml(x.who)} — <strong>${escapeHtml(x.avg)}</strong> <span class="muted">(${escapeHtml(x.n)} filmer)</span></div>`
  ).join('') || '–';

  $('tops').innerHTML = `<div class="row"><div class="col"><label>Bästa filmer</label>${films}</div><div class="col"><label>Bästa väljare</label>${pickers}</div></div>`;
}

async function loadHistory(){
  const hist = await api('getHistory', { limit: 10 });
  const rows = (hist.rows||[]).map(r=>{
    const nums = PEOPLE.map(p=>Number(r[p])||0).filter(x=>x>0);
    const avg = nums.length ? round1(nums.reduce((a,b)=>a+b,0)/nums.length) : '-';
    const per = PEOPLE.map(p=>`${p}: ${r[p]||'-'}`).join(' • ');
    return `<div class="pill" style="display:block;margin:6px 0;padding:10px 12px">
      <strong>${escapeHtml(r['Film']||'–')}</strong> — ${escapeHtml(r['Datum']||'')}
      <span class="muted"> (val: ${escapeHtml(r['Vem valde']||'-')}, Snitt: ${escapeHtml(avg)})</span><br/>
      <span class="muted">${escapeHtml(per)}</span>
    </div>`;
  }).join('');
  $('history').innerHTML = rows || 'Tomt.';
}

async function saveMyList(){
  const who = $('who')?.value || '';
  if(!who) return;

  const payload = { person: who };
  for(let i=1;i<=5;i++) payload['R'+i] = $('w'+i)?.value || '';

  setStatus(true, 'sparar lista…');
  await api('saveWishlist', payload);
  setStatus(true, 'lista sparad');
}

async function saveNight(){
  const who = String($('nextName')?.value || '').trim();
  const film = String($('suggested')?.value || '').trim();
  const comment = String($('comment')?.value || '').trim();

  if(!who || !film){
    setStatus(false, 'saknar “Nästa i tur” eller film');
    return;
  }

  const btn = $('saveNight');
  if(btn){ btn.disabled = true; btn.textContent = 'Sparar…'; }

  try{
    await api('saveNight', { who, film, comment });
    $('comment').value = '';
    setStatus(true, 'kväll sparad');
    await loadAll();
  }catch(e){
    console.error(e);
    setStatus(false, e.message || 'saveNight');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Spara kväll'; }
  }
}

async function loadAll(){
  // Spara lokala hemligheter om användaren ändrat inputs
  saveLocalSecretsFromInputs();

  const now = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'});
  setStatus(true, 'laddar…');

  await loadCurrent();
  await loadMyList();
  await loadTops();
  await loadHistory();

  setStatus(true, `API svarar – uppdaterat ${now}`);
}

function bindSettings(){
  // Spara token lokalt när man skriver/blur
  $('pwInput')?.addEventListener('input', ()=>{
    const v = String($('pwInput').value || '').trim();
    if(v) localStorage.setItem(LS.token, v);
  });
  $('pwInput')?.addEventListener('blur', ()=>saveLocalSecretsFromInputs());

  // valfria nycklar
  ['tmdbKeyInput','omdbKeyInput','watchmodeKeyInput'].forEach(id=>{
    $(id)?.addEventListener('blur', ()=>saveLocalSecretsFromInputs());
  });
}

function setVersion(){
  const el = $('appVersion');
  if(!el) return;
  try{
    const d = new Date(document.lastModified);
    if(isNaN(d)) { el.textContent = 'okänd'; return; }
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    el.textContent = `${y}-${m}-${day} ${hh}:${mm}`;
  }catch{ el.textContent = 'okänd'; }
}

function bindActions(){
  $('loadList')?.addEventListener('click', ()=>loadMyList().catch(e=>setStatus(false, e.message||'getWishlist')));
  $('saveList')?.addEventListener('click', ()=>saveMyList().catch(e=>setStatus(false, e.message||'saveWishlist')));
  $('saveNight')?.addEventListener('click', ()=>saveNight().catch(()=>{}));

  // Om användaren ändrar film/kommentar – lås inte knappen
  $('comment')?.addEventListener('input', ()=>{ const b=$('saveNight'); if(b) b.disabled=false; });
  $('suggested')?.addEventListener('input', ()=>{ const b=$('saveNight'); if(b) b.disabled=false; });
}

// ====== Start ======
(async function main(){
  setVersion();
  renderPeopleSelect();
  bindTheme();
  loadLocalSecretsToInputs();
  bindSettings();

  renderScoresRow();
  renderWishlistInputs();
  bindActions();

  // Om ingen token finns: visa vänlig status och avvakta
  if(!getToken()){
    setStatus(false, 'Ange token i Inställningar.');
    return;
  }

  try{
    await loadAll();
  }catch(e){
    console.error(e);
    setStatus(false, e.message || 'Kunde inte kontakta API');
  }
})();
