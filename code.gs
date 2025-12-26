/** =======================
 *  Filmkväll – Google Apps Script API (code.gs)
 *  Blad:
 *   - Config   : Key | Value              (nextIndex, people)
 *   - Wishlists: Person | R1..R5
 *   - Scores   : Hannah | Maria | Tuva | Alva | Lars
 *   - History  : Datum | Film | Vem valde | Kommentar | Hannah | Maria | Tuva | Alva | Lars
 *  =======================
 *  Säkerhet:
 *   - Standardläge: AUTH_REQUIRED=0 => ingen auth (familje-app / GitHub Pages)
 *   - Skärpning: sätt Script Property AUTH_REQUIRED=1 och använd API_TOKEN (och ev PW fallback)
 *   - (Valfritt) ENFORCE_POST=1 för att kräva POST för muterande anrop
 *
 *  Nytt:
 *   - actions: autocomplete, lookupMovie, streaming (för att slippa nycklar i index.html)
 */

/** =========================================================
 *  ONE-TIME SETUP (kör en gång manuellt)
 *  - Sätter Script Properties: TMDB_KEY, OMDB_KEY, WATCHMODE_KEY
 *  - Efter körning: du kan radera funktionen (valfritt).
 * ========================================================= */
function SETUP_SECRETS_ONCE(){
  const props = PropertiesService.getScriptProperties();

  // Dessa tre nycklar kommer från dig.
  // Efter att de är satta i Script Properties behöver de INTE finnas i koden.
  props.setProperty('TMDB_KEY', 'e207103e8a03559e4be5970b8c899122');
  props.setProperty('OMDB_KEY', 'b6f3e48');
  props.setProperty('WATCHMODE_KEY', '6fs0TqcE6LrZttIvVKKJ1Heg97B161Ay1HntH9Vq');

  Logger.log('OK: TMDB_KEY/OMDB_KEY/WATCHMODE_KEY satta i Script Properties.');
}

/** ===== Security helpers ===== */
function secureEq_(a,b){
  a = String(a || '');
  b = String(b || '');
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i=0;i<len;i++){
    const ca = a.charCodeAt(i) || 0;
    const cb = b.charCodeAt(i) || 0;
    diff |= (ca ^ cb);
  }
  return diff === 0;
}

function getPw_(){
  const v = PropertiesService.getScriptProperties().getProperty('PW');
  const pw = (v && String(v).trim()) ? String(v) : '';
  if (!pw) throw new Error('PW not configured (set Script Property PW)');
  return pw;
}

function getApiToken_(){
  const v = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  const t = (v && String(v).trim()) ? String(v) : '';
  if (!t) throw new Error('API_TOKEN not configured (set Script Property API_TOKEN)');
  return t;
}

function getDebugToken_(){
  return PropertiesService.getScriptProperties().getProperty('DEBUG_TOKEN') || '';
}

function redactSecrets_(obj){
  const out = {};
  Object.keys(obj || {}).forEach(k => {
    if (k === 'pw' || k === 'token' || k === 'debugToken') return;
    out[k] = obj[k];
  });
  return out;
}

function isDebugEnabled_(){
  const v = PropertiesService.getScriptProperties().getProperty('DEBUG_ENABLED');
  return String(v == null ? '1' : v) !== '0';
}

function shouldEnforcePost_(){
  const v = PropertiesService.getScriptProperties().getProperty('ENFORCE_POST');
  return String(v || '') === '1';
}

function isWriteAction_(action){
  return ['saveScores','saveWishlist','skipNext','saveNight'].indexOf(action) >= 0;
}

function isPost_(e){
  return !!(e && e.postData && typeof e.postData.contents === 'string');
}

function isAuthRequired_(){
  const v = PropertiesService.getScriptProperties().getProperty('AUTH_REQUIRED');
  return String(v || '0') === '1';
}

function tooManyBadPw_(){
  const props = PropertiesService.getScriptProperties();
  const key = 'BAD_AUTH_MINUTE';
  const nowMin = Math.floor(Date.now() / 60000);

  let state = { min: nowMin, n: 0 };
  try {
    const raw = props.getProperty(key);
    if (raw) state = JSON.parse(raw);
  } catch (_) {
    state = { min: nowMin, n: 0 };
  }

  if (state.min !== nowMin) state = { min: nowMin, n: 0 };
  state.n++;
  props.setProperty(key, JSON.stringify(state));
  return state.n > 20;
}

const PEOPLE_DEFAULT = ['Hannah','Maria','Tuva','Alva','Lars'];
const TZ = 'Europe/Stockholm';

/** ===== External API keys (Script Properties) ===== */
function getTmdbKey_(){
  return (PropertiesService.getScriptProperties().getProperty('TMDB_KEY') || '').trim();
}
function getOmdbKey_(){
  return (PropertiesService.getScriptProperties().getProperty('OMDB_KEY') || '').trim();
}
function getWatchmodeKey_(){
  return (PropertiesService.getScriptProperties().getProperty('WATCHMODE_KEY') || '').trim();
}

/** ===== HTTP entry ===== */
function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); }

function getParams_(e){
  const base = (e && e.parameter) ? e.parameter : {};
  const out = {};
  Object.keys(base || {}).forEach(k => out[k] = base[k]);

  if (e && e.postData && typeof e.postData.contents === 'string' && e.postData.contents) {
    const ct = String(e.postData.type || e.postData.contentType || '').toLowerCase();
    if (ct.indexOf('application/json') >= 0) {
      try {
        const obj = JSON.parse(e.postData.contents);
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach(k => {
            if (!(k in out)) out[k] = obj[k];
          });
        }
      } catch (_) {}
    }
  }
  return out;
}

function handle_(e) {
  try {
    const p = getParams_(e);
    const action = String(p.action || '').trim();
    if (!action) return json_({ ok:false, error:'action required' });

    const allowedActions = {
      ping:1, debug:1,
      getCurrent:1, getScores:1, saveScores:1,
      getWishlist:1, saveWishlist:1,
      getTops:1, getHistory:1,
      skipNext:1, saveNight:1,

      // NEW:
      autocomplete:1, lookupMovie:1, streaming:1
    };
    if (!allowedActions[action]) return json_({ ok:false, error:'unknown action', got:action });

    if (shouldEnforcePost_() && isWriteAction_(action) && !isPost_(e)) {
      return json_({ ok:false, error:'POST required' });
    }

    if (action !== 'ping' && isAuthRequired_()) {
      const tokenOk = secureEq_(p.token || '', getApiToken_());
      const pwOk = (p.pw != null && p.pw !== '') ? secureEq_(p.pw || '', getPw_()) : false;

      if (!(tokenOk || pwOk)) {
        if (tooManyBadPw_()) return json_({ ok:false, error:'rate limited' });
        return json_({ ok:false, error:'bad auth' });
      }
    }

    ensureSheets_();

    switch (action) {
      case 'ping':         return json_({ ok:true, time:new Date().toISOString() });
      case 'debug':
        if (!isDebugEnabled_()) return json_({ ok:false, error:'debug disabled' });
        const dbg = getDebugToken_();
        if (dbg && !secureEq_(p.debugToken || '', dbg)) return json_({ ok:false, error:'bad debug token' });
        return json_({ ok:true, received: redactSecrets_(p) });

      case 'getCurrent':   return json_(getCurrent_());
      case 'getScores':    return json_(getScores_());
      case 'saveScores':   return json_(saveScores_(p));
      case 'getWishlist':  return json_(getWishlist_(p));
      case 'saveWishlist': return json_(saveWishlist_(p));
      case 'getTops':      return json_(getTops_(p));
      case 'getHistory':   return json_(getHistory_(p));
      case 'skipNext':     return json_(skipNext_());
      case 'saveNight':    return json_(saveNight_(p));

      // NEW:
      case 'autocomplete': return json_(autocomplete_(p));
      case 'lookupMovie':  return json_(lookupMovie_(p));
      case 'streaming':    return json_(streaming_(p));

      default:             return json_({ ok:false, error:'unknown action', got:action });
    }
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

/** ===== Helpers ===== */
function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function getOrCreateSheet_(name){ return ss_().getSheetByName(name) || ss_().insertSheet(name); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function toNum_(v){ const n = Number(v); return isFinite(n) ? n : ''; }
function trim_(v){ return String(v == null ? '' : v).trim(); }

/** ===== People from Config (fallback to default) ===== */
function getPeople_(){
  const fromCfg = getConfig_('people');
  if (fromCfg && String(fromCfg).trim()) {
    return String(fromCfg)
      .split(',')
      .map(s => String(s).trim())
      .filter(Boolean);
  }
  return PEOPLE_DEFAULT.slice();
}

/** ===== Ensure sheets & headers ===== */
function ensureSheets_(){
  const PEOPLE = getPeople_();

  const shC = getOrCreateSheet_('Config');
  if (shC.getLastRow() === 0) shC.getRange(1,1,1,2).setValues([['Key','Value']]);
  if (getConfig_('people') === null) setConfig_('people', PEOPLE_DEFAULT.join(','));
  if (getConfig_('nextIndex') === null) setConfig_('nextIndex', '0');

  const shW = getOrCreateSheet_('Wishlists');
  if (shW.getLastRow() === 0){
    shW.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    shW.getRange(2,1,PEOPLE.length,6).setValues(PEOPLE.map(p=>[p,'','','','','']));
  } else {
    const existing = shW
      .getRange(2,1,Math.max(0,shW.getLastRow()-1),1)
      .getValues()
      .flat()
      .map(String);
    PEOPLE.forEach(p=>{ if (!existing.includes(p)) shW.appendRow([p,'','','','','']); });
  }

  const shS = getOrCreateSheet_('Scores');
  const headS = PEOPLE.slice();
  if (shS.getLastRow() === 0){
    shS.getRange(1,1,1,headS.length).setValues([headS]);
    shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
  } else {
    const h = shS.getRange(1,1,1,shS.getLastColumn()).getValues()[0];
    if (h.join('|') !== headS.join('|')){
      shS.clear();
      shS.getRange(1,1,1,headS.length).setValues([headS]);
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    } else if (shS.getLastRow() < 2){
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }
  }

  const shH = getOrCreateSheet_('History');
  const headH = ['Datum','Film','Vem valde','Kommentar'].concat(PEOPLE);
  if (shH.getLastRow() === 0){
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  } else {
    const h = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    if (h.join('|') !== headH.join('|')){
      if (shH.getLastColumn() < headH.length) {
        shH.insertColumnsAfter(shH.getLastColumn(), headH.length - shH.getLastColumn());
      }
      shH.getRange(1,1,1,headH.length).setValues([headH]);
    }
  }
}

/** ===== Config get/set ===== */
function getConfig_(key){
  const sh = ss_().getSheetByName('Config');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for (const [k,v] of rows) {
    if (k === key) return v;
  }
  return null;
}

function setConfig_(key,value){
  const sh = ss_().getSheetByName('Config');
  const last = sh.getLastRow();
  if (last < 1) sh.getRange(1,1,1,2).setValues([['Key','Value']]);

  const dataLast = sh.getLastRow();
  if (dataLast < 2){
    sh.appendRow([key,value]);
    return;
  }

  const rows = sh.getRange(2,1,dataLast-1,2).getValues();
  for (let i=0;i<rows.length;i++){
    if (rows[i][0] === key){
      sh.getRange(i+2,2).setValue(value);
      return;
    }
  }
  sh.appendRow([key,value]);
}

/** ===== Actions ===== */
function getCurrent_(){
  const PEOPLE = getPeople_();
  const idx = Number(getConfig_('nextIndex') || '0') % PEOPLE.length;
  const who = PEOPLE[idx];
  const suggestion = (getWishlist_({ person: who }).R1 || '');
  return { ok:true, next:who, suggestion, scores: getScores_().scores };
}

function getScores_(){
  const sh = ss_().getSheetByName('Scores');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const row = sh.getRange(2,1,1,headers.length).getValues()[0];
  const scores = {};
  headers.forEach((h,i)=> scores[h] = row[i] === '' ? '' : row[i]);
  return { ok:true, scores };
}

function saveScores_(p){
  try{
    const incomingRaw = p.scores ? JSON.parse(p.scores) : {};
    const incoming = {};
    Object.keys(incomingRaw || {}).forEach(k => {
      const v = incomingRaw[k];
      incoming[k] = (v === '' || v == null) ? '' : toNum_(v);
    });

    const sh = ss_().getSheetByName('Scores');
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(2,1,1,headers.length).getValues()[0];
    headers.forEach((h,i)=>{
      if (Object.prototype.hasOwnProperty.call(incoming,h)) row[i] = incoming[h];
    });
    sh.getRange(2,1,1,headers.length).setValues([row]);
    return { ok:true };
  } catch(e){
    return { ok:false, error:String(e) };
  }
}

function getWishlist_(p){
  const who = trim_(p.person);
  if (!who) return { ok:false, error:'person required' };
  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for (let r=0;r<vals.length;r++){
    if (String(vals[r][0]) === who) {
      return { ok:true,
        R1: vals[r][1] || '',
        R2: vals[r][2] || '',
        R3: vals[r][3] || '',
        R4: vals[r][4] || '',
        R5: vals[r][5] || ''
      };
    }
  }
  sh.appendRow([who,'','','','','']);
  return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
}

function saveWishlist_(p){
  const who = trim_(p.person);
  if (!who) return { ok:false, error:'person required' };

  const R1 = trim_(p.R1), R2 = trim_(p.R2), R3 = trim_(p.R3), R4 = trim_(p.R4), R5 = trim_(p.R5);

  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if (lastRow < 2){
    sh.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    sh.appendRow([who,R1,R2,R3,R4,R5]);
    return { ok:true };
  }
  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for (let r=0;r<vals.length;r++){
    if (String(vals[r][0]) === who){
      sh.getRange(r+2,2,1,5).setValues([[R1,R2,R3,R4,R5]]);
      return { ok:true };
    }
  }
  sh.appendRow([who,R1,R2,R3,R4,R5]);
  return { ok:true };
}

function getHistory_(p){
  const limit = Math.max(1, Number(p.limit||10));
  const sh = ss_().getSheetByName('History');
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok:true, rows:[] };
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0];
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  const out = [];
  for (let i=data.length-1; i>=0 && out.length<limit; i--){
    const obj = {};
    headers.forEach((h,idx)=> obj[h] = data[i][idx]);
    out.push(obj);
  }
  return { ok:true, rows:out };
}

function getTops_(p){
  const PEOPLE = getPeople_();
  const limit = Math.max(1, Number(p.limit||5));
  const sh = ss_().getSheetByName('History');
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok:true, bestFilms:[], bestPickers:[] };
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0];
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  const idxFilm = headers.indexOf('Film');
  const idxPicker = headers.indexOf('Vem valde');
  const idxByPerson = {}; PEOPLE.forEach(pn=> idxByPerson[pn] = headers.indexOf(pn));

  const filmStats = {};
  data.forEach(row=>{
    const film = String(row[idxFilm]||'').trim();
    if (!film) return;
    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const v = Number(row[idxByPerson[pn]]);
      if (isFinite(v) && v>0){ sum += v; n++; }
    });
    if (n>0){
      if (!filmStats[film]) filmStats[film] = { sum:0, n:0, who:String(row[idxPicker]||'') };
      filmStats[film].sum += (sum/n);
      filmStats[film].n  += 1;
      filmStats[film].who = String(row[idxPicker]||'');
    }
  });
  const bestFilms = Object.keys(filmStats).map(f=>({
    film:f,
    avg: Math.round((filmStats[f].sum/filmStats[f].n)*10)/10,
    who:filmStats[f].who
  })).sort((a,b)=> b.avg - a.avg).slice(0,limit);

  const pickerStats = {};
  data.forEach(row=>{
    const picker = String(row[idxPicker]||'').trim();
    if (!picker) return;
    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const v = Number(row[idxByPerson[pn]]);
      if (isFinite(v) && v>0){ sum += v; n++; }
    });
    if (n>0){
      if (!pickerStats[picker]) pickerStats[picker] = { sumAvg:0, n:0, films:0 };
      pickerStats[picker].sumAvg += (sum/n);
      pickerStats[picker].n += 1;
      pickerStats[picker].films += 1;
    }
  });
  const bestPickers = Object.keys(pickerStats).map(w=>({
    who:w,
    avg: Math.round((pickerStats[w].sumAvg/pickerStats[w].n)*10)/10,
    n: pickerStats[w].films
  })).sort((a,b)=> b.avg - a.avg).slice(0,limit);

  return { ok:true, bestFilms, bestPickers };
}

function skipNext_(){
  const PEOPLE = getPeople_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok:false, error:'lock timeout' };
  try{
    let idx = Number(getConfig_('nextIndex') || '0') % PEOPLE.length;
    idx = (idx + 1) % PEOPLE.length;
    setConfig_('nextIndex', String(idx));
    return { ok:true, next: PEOPLE[idx] };
  } finally {
    lock.releaseLock();
  }
}

function saveNight_(p){
  const PEOPLE = getPeople_();
  const who = trim_(p.who);
  const film = trim_(p.film);
  const comment = trim_(p.comment);
  if (!who || !film) return { ok:false, error:'who and film required' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok:false, error:'lock timeout' };
  try{
    const scores = (getScores_().scores || {});

    const shH = ss_().getSheetByName('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    const row = [];
    headers.forEach(h=>{
      if (h === 'Datum') row.push(today_());
      else if (h === 'Film') row.push(film);
      else if (h === 'Vem valde') row.push(who);
      else if (h === 'Kommentar') row.push(comment);
      else if (PEOPLE.indexOf(h) >= 0) row.push(toNum_(scores[h]));
      else row.push('');
    });
    shH.appendRow(row);

    const shS = ss_().getSheetByName('Scores');
    shS.getRange(2,1,1,PEOPLE.length).setValues([PEOPLE.map(_=>'')]);

    const shW = ss_().getSheetByName('Wishlists');
    const lastRow = shW.getLastRow();
    if (lastRow >= 2){
      const vals = shW.getRange(2,1,lastRow-1,6).getValues();
      for (let r=0;r<vals.length;r++){
        if (String(vals[r][0]) === who){
          const newRow = [who, vals[r][2]||'', vals[r][3]||'', vals[r][4]||'', vals[r][5]||'', '' ];
          shW.getRange(r+2,1,1,6).setValues([newRow]);
          break;
        }
      }
    }

    const whoIdx = PEOPLE.indexOf(who);
    const nextIdx = whoIdx >= 0
      ? (whoIdx+1)%PEOPLE.length
      : (Number(getConfig_('nextIndex')||'0')+1)%PEOPLE.length;

    setConfig_('nextIndex', String(nextIdx));
    return { ok:true, nextPerson: PEOPLE[nextIdx] };
  } finally {
    lock.releaseLock();
  }
}

/** =========================================================
 *  NEW: autocomplete (TMDb)
 *  Request: { q: "matrix" }
 *  Response: { ok:true, items:[{title,year},...] }
 * ========================================================= */
function autocomplete_(p){
  const q = trim_(p.q);
  if (q.length < 2) return { ok:true, items: [] };

  const key = getTmdbKey_();
  if (!key) return { ok:true, items: [] };

  try{
    const url = 'https://api.themoviedb.org/3/search/movie'
      + '?api_key=' + encodeURIComponent(key)
      + '&language=sv-SE'
      + '&include_adult=false'
      + '&query=' + encodeURIComponent(q);

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return { ok:true, items: [] };

    const j = JSON.parse(res.getContentText() || '{}');
    const results = Array.isArray(j.results) ? j.results : [];
    const items = results.slice(0, 8).map(it => ({
      title: it.title || it.original_title || '',
      year: (it.release_date || '').slice(0,4) || ''
    })).filter(x => x.title);

    return { ok:true, items: items };
  }catch(e){
    return { ok:true, items: [] };
  }
}

/** =========================================================
 *  NEW: lookupMovie (OMDb-first, TMDb fallback)
 *  Request: { q: "The Matrix (1999)" }
 *  Response: { ok:true, data:{Title,Year,Poster,imdbID,imdbRating} }
 * ========================================================= */
function lookupMovie_(p){
  const q0 = trim_(p.q);
  if (!q0) return { ok:true, data: null };

  // 1) OMDb först
  const om = omdbLookup_(q0);
  if (om) return { ok:true, data: om };

  // 2) TMDb fallback: hitta film, plocka imdb_id via external_ids, sen OMDb igen om möjligt
  const tm = tmdbBestHit_(q0);
  if (!tm) return { ok:true, data: null };

  if (tm.imdbID){
    const om2 = omdbLookup_(tm.imdbID);
    if (om2) return { ok:true, data: om2 };
  }

  // 3) Returnera “OMDb-lik” från TMDb
  return { ok:true, data: {
    Title: tm.Title || '',
    Year: tm.Year || '',
    Poster: tm.Poster || 'N/A',
    imdbID: tm.imdbID || '',
    imdbRating: tm.imdbRating || '-'
  }};
}

function omdbLookup_(query){
  const key = getOmdbKey_();
  if (!key) return null;

  let q = String(query || '').trim();
  if (!q) return null;

  // (1999) parsing
  let year = '';
  const mYear = q.match(/\((\d{4})\)\s*$/);
  if (mYear){
    year = mYear[1];
    q = q.replace(/\s*\(\d{4}\)\s*$/,'').trim();
  }

  // imdb id in query
  const mTT = q.match(/tt\d{7,}/i);
  if (mTT){
    const id = mTT[0];
    const url = 'https://www.omdbapi.com/?apikey=' + encodeURIComponent(key)
      + '&i=' + encodeURIComponent(id) + '&plot=short';
    try{
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
      const j = JSON.parse(res.getContentText() || '{}');
      if (j && j.Response !== 'False') return j;
    }catch(e){}
    return null;
  }

  // title lookup
  try{
    const urlT = 'https://www.omdbapi.com/?apikey=' + encodeURIComponent(key)
      + '&t=' + encodeURIComponent(q)
      + (year ? '&y=' + encodeURIComponent(year) : '')
      + '&type=movie&plot=short';
    const resT = UrlFetchApp.fetch(urlT, { muteHttpExceptions:true });
    const jT = JSON.parse(resT.getContentText() || '{}');
    if (jT && jT.Response !== 'False') return jT;
  }catch(e){}

  // search fallback
  try{
    const urlS = 'https://www.omdbapi.com/?apikey=' + encodeURIComponent(key)
      + '&s=' + encodeURIComponent(q) + '&type=movie';
    const resS = UrlFetchApp.fetch(urlS, { muteHttpExceptions:true });
    const jS = JSON.parse(resS.getContentText() || '{}');
    if (jS && jS.Response !== 'False' && Array.isArray(jS.Search) && jS.Search.length){
      return omdbLookup_(jS.Search[0].Title);
    }
  }catch(e){}

  return null;
}

function tmdbBestHit_(query){
  const key = getTmdbKey_();
  if (!key) return null;

  const q = String(query || '').trim();
  if (!q) return null;

  try{
    const url = 'https://api.themoviedb.org/3/search/movie'
      + '?api_key=' + encodeURIComponent(key)
      + '&language=sv-SE'
      + '&include_adult=false'
      + '&query=' + encodeURIComponent(q);

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText() || '{}');
    const results = Array.isArray(j.results) ? j.results : [];
    if (!results.length) return null;

    // välj första träffen (enkel och stabil)
    const best = results[0];

    let imdbID = '';
    try{
      const idsUrl = 'https://api.themoviedb.org/3/movie/' + encodeURIComponent(best.id)
        + '/external_ids?api_key=' + encodeURIComponent(key);
      const res2 = UrlFetchApp.fetch(idsUrl, { muteHttpExceptions:true });
      if (res2.getResponseCode() === 200){
        const ids = JSON.parse(res2.getContentText() || '{}');
        imdbID = ids.imdb_id || '';
      }
    }catch(e){}

    const poster = best.poster_path ? ('https://image.tmdb.org/t/p/w92' + best.poster_path) : 'N/A';
    const year = (best.release_date || '').slice(0,4) || '';
    return { Title: best.title || best.original_title || '', Year: year, Poster: poster, imdbID: imdbID, imdbRating: '-' };
  }catch(e){
    return null;
  }
}

/** =========================================================
 *  NEW: streaming (Watchmode)
 *  Request: { imdbID: "tt0133093" }
 *  Response: { ok:true, items:[{service,quality,region,link}...] }  (eller null)
 * ========================================================= */
function streaming_(p){
  const imdbID = trim_(p.imdbID);
  if (!imdbID) return { ok:true, items: null };

  const key = getWatchmodeKey_();
  if (!key) return { ok:true, items: null };

  try{
    const titleId = watchmodeTitleIdFromImdb_(key, imdbID);
    if (!titleId) return { ok:true, items: null };

    const url = 'https://api.watchmode.com/v1/title/' + encodeURIComponent(titleId)
      + '/sources/?apiKey=' + encodeURIComponent(key);

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return { ok:true, items: null };

    const data = JSON.parse(res.getContentText() || '[]');
    if (!Array.isArray(data)) return { ok:true, items: null };

    const seen = {};
    function normName_(s){ return String(s||'').replace(/\s*\(with Ads\)$/i,'').replace(/\s+HD$/,'').trim(); }

    const items = data
      .filter(s => s && s.type === 'sub' && s.name)
      .map(s => ({
        service: normName_(s.name),
        quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
        region: s.region || '',
        link: s.web_url || ''
      }))
      .filter(s => {
        const k = s.service + '|' + s.quality + '|' + s.region;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .sort((a,b)=>(a.service+a.region+a.quality).localeCompare(b.service+b.region+b.quality));

    return { ok:true, items: items.length ? items : null };
  }catch(e){
    return { ok:true, items: null };
  }
}

function watchmodeTitleIdFromImdb_(apiKey, imdbID){
  // 1) find
  try{
    const u1 = 'https://api.watchmode.com/v1/find/?apiKey=' + encodeURIComponent(apiKey)
      + '&source=imdb&external_id=' + encodeURIComponent(imdbID);
    const r1 = UrlFetchApp.fetch(u1, { muteHttpExceptions:true });
    if (r1.getResponseCode() === 200){
      const j1 = JSON.parse(r1.getContentText() || '{}');
      if (j1 && j1.title_id) return j1.title_id;
    }
  }catch(e){}

  // 2) search fallback
  try{
    const u2 = 'https://api.watchmode.com/v1/search/?apiKey=' + encodeURIComponent(apiKey)
      + '&search_field=imdb_id&search_value=' + encodeURIComponent(imdbID);
    const r2 = UrlFetchApp.fetch(u2, { muteHttpExceptions:true });
    if (r2.getResponseCode() === 200){
      const j2 = JSON.parse(r2.getContentText() || '{}');
      const arr = Array.isArray(j2.title_results) ? j2.title_results : [];
      const hit = arr.find(x => String(x.imdb_id||'') === String(imdbID));
      if (hit && hit.id) return hit.id;
    }
  }catch(e){}

  return null;
}