/** =======================
 * Filmkväll – Google Apps Script API (Code.gs)
 * Passar din index.htm (GET: action + pw)
 *
 * Blad:
 *  - Config   : Key | Value              (nextIndex, people)
 *  - Wishlists: Person | R1..R5
 *  - Scores   : Hannah | Maria | Tuva | Alva | Lars
 *  - History  : Datum | Film | Vem valde | Kommentar | Hannah | Maria | Tuva | Alva | Lars
 * ======================= */

const TZ = 'Europe/Stockholm';
const PEOPLE_DEFAULT = ['Hannah','Maria','Tuva','Alva','Lars'];

// Enkel auth (matchar din front-end som skickar pw i query string)
function getPw_(){
  const props = PropertiesService.getScriptProperties();
  const pw = String(props.getProperty('PW') || '').trim();
  if (pw) return pw;
  // Fallback så det “bara funkar” även om du inte satt property än:
  return 'Look4fun';
}
function bad_(msg){ return json_({ ok:false, error:String(msg||'error') }); }
function ok_(obj){ return json_(Object.assign({ ok:true }, obj||{})); }

function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); } // funkar ändå, men din front-end kör GET

function handle_(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const action = String(p.action || '').trim();
    const pw = String(p.pw || '').trim();

    if (!action) return bad_('action required');
    if (pw !== getPw_()) return bad_('bad pw');

    ensureSheets_();

    switch(action){
      case 'getCurrent':   return json_(getCurrent_());
      case 'getScores':    return json_(getScores_());
      case 'saveScores':   return json_(saveScores_(p));
      case 'getWishlist':  return json_(getWishlist_(p));
      case 'saveWishlist': return json_(saveWishlist_(p));
      case 'getTops':      return json_(getTops_(p));
      case 'getHistory':   return json_(getHistory_(p));
      case 'skipNext':     return json_(skipNext_());
      case 'saveNight':    return json_(saveNight_(p));
      default:             return bad_('unknown action');
    }
  }catch(err){
    return bad_(String(err));
  }
}

/** ===== JSON response helper ===== */
function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ===== Spreadsheet helpers ===== */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(name){ return ss_().getSheetByName(name) || ss_().insertSheet(name); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function trim_(v){ return String(v == null ? '' : v).trim(); }
function toNumOrBlank_(v){
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const n = Number(s);
  return isFinite(n) ? n : '';
}

/** ===== Config get/set ===== */
function getConfig_(key){
  const sh = sh_('Config');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for (const r of rows){
    if (String(r[0]) === key) return r[1];
  }
  return null;
}
function setConfig_(key, value){
  const sh = sh_('Config');
  if (sh.getLastRow() === 0){
    sh.getRange(1,1,1,2).setValues([['Key','Value']]);
  }
  const last = sh.getLastRow();
  if (last < 2){
    sh.appendRow([key, value]);
    return;
  }
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][0]) === key){
      sh.getRange(i+2,2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

/** ===== People ===== */
function getPeople_(){
  const v = getConfig_('people');
  if (v != null && String(v).trim()){
    const arr = String(v).split(',').map(s=>s.trim()).filter(Boolean);
    if (arr.length) return arr;
  }
  return PEOPLE_DEFAULT.slice();
}

/** ===== Ensure sheets exist + headers ===== */
function ensureSheets_(){
  const PEOPLE = getPeople_();

  // Config
  const shC = sh_('Config');
  if (shC.getLastRow() === 0) shC.getRange(1,1,1,2).setValues([['Key','Value']]);
  if (getConfig_('people') === null) setConfig_('people', PEOPLE_DEFAULT.join(','));
  if (getConfig_('nextIndex') === null) setConfig_('nextIndex', '0');

  // Wishlists
  const shW = sh_('Wishlists');
  if (shW.getLastRow() === 0){
    shW.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    shW.getRange(2,1,PEOPLE.length,6).setValues(PEOPLE.map(p=>[p,'','','','','']));
  } else {
    // Säkerställ header
    const head = shW.getRange(1,1,1,6).getValues()[0].map(String);
    const want = ['Person','R1','R2','R3','R4','R5'];
    if (head.join('|') !== want.join('|')){
      shW.getRange(1,1,1,6).setValues([want]);
    }
    // Säkerställ rader för alla personer
    const existing = shW.getRange(2,1,Math.max(0, shW.getLastRow()-1),1).getValues().flat().map(String);
    PEOPLE.forEach(p=>{ if (!existing.includes(p)) shW.appendRow([p,'','','','','']); });
  }

  // Scores
  const shS = sh_('Scores');
  const headS = PEOPLE.slice();
  if (shS.getLastRow() === 0){
    shS.getRange(1,1,1,headS.length).setValues([headS]);
    shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
  } else {
    const h = shS.getRange(1,1,1,shS.getLastColumn()).getValues()[0].map(String);
    if (h.join('|') !== headS.join('|')){
      shS.clear();
      shS.getRange(1,1,1,headS.length).setValues([headS]);
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    } else if (shS.getLastRow() < 2){
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }
  }

  // History
  const shH = sh_('History');
  const headH = ['Datum','Film','Vem valde','Kommentar'].concat(PEOPLE);
  if (shH.getLastRow() === 0){
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  } else {
    const h = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0].map(String);
    if (h.join('|') !== headH.join('|')){
      if (shH.getLastColumn() < headH.length){
        shH.insertColumnsAfter(shH.getLastColumn(), headH.length - shH.getLastColumn());
      }
      shH.getRange(1,1,1,headH.length).setValues([headH]);
    }
  }
}

/** ===== Wishlists: robust row lookup ===== */
function findWishlistRow_(person){
  const who = trim_(person);
  const shW = sh_('Wishlists');
  const last = shW.getLastRow();
  if (last < 2) return null;

  const vals = shW.getRange(2,1,last-1,6).getValues(); // [Person,R1..R5]
  for (let i=0;i<vals.length;i++){
    if (String(vals[i][0]) === who) return { rowIndex: i+2, row: vals[i] };
  }
  // Om saknas: lägg till
  shW.appendRow([who,'','','','','']);
  return { rowIndex: shW.getLastRow(), row: [who,'','','','',''] };
}

/** ===== Actions ===== */

function getCurrent_(){
  const PEOPLE = getPeople_();
  const idxRaw = Number(getConfig_('nextIndex') || '0');
  const idx = ((idxRaw % PEOPLE.length) + PEOPLE.length) % PEOPLE.length;
  const who = PEOPLE[idx];

  // Här är det som avgör din bug: suggestion måste vara R1 för who
  const wl = getWishlist_({ person: who });
  const suggestion = (wl && wl.ok) ? (wl.R1 || '') : '';

  const scores = getScores_().scores || {};
  return { ok:true, next: who, suggestion: suggestion, scores: scores };
}

function getScores_(){
  const PEOPLE = getPeople_();
  const shS = sh_('Scores');
  const headers = shS.getRange(1,1,1,PEOPLE.length).getValues()[0].map(String);
  const row = shS.getRange(2,1,1,PEOPLE.length).getValues()[0];

  const scores = {};
  headers.forEach((h,i)=> scores[h] = row[i] === '' ? '' : row[i]);
  return { ok:true, scores: scores };
}

function saveScores_(p){
  // p.scores är JSON-sträng från front-end: {"Hannah":"7"} etc.
  const PEOPLE = getPeople_();
  const raw = p.scores ? String(p.scores) : '{}';
  let incoming = {};
  try{ incoming = JSON.parse(raw) || {}; }catch(_){ incoming = {}; }

  const shS = sh_('Scores');
  const headers = shS.getRange(1,1,1,PEOPLE.length).getValues()[0].map(String);
  const row = shS.getRange(2,1,1,PEOPLE.length).getValues()[0];

  headers.forEach((h,i)=>{
    if (Object.prototype.hasOwnProperty.call(incoming, h)){
      row[i] = toNumOrBlank_(incoming[h]);
    }
  });

  shS.getRange(2,1,1,PEOPLE.length).setValues([row]);
  return { ok:true };
}

function getWishlist_(p){
  const who = trim_(p.person);
  if (!who) return { ok:false, error:'person required' };

  const hit = findWishlistRow_(who);
  const r = hit ? hit.row : [who,'','','','',''];
  return {
    ok:true,
    R1: r[1] || '',
    R2: r[2] || '',
    R3: r[3] || '',
    R4: r[4] || '',
    R5: r[5] || ''
  };
}

function saveWishlist_(p){
  const who = trim_(p.person);
  if (!who) return { ok:false, error:'person required' };

  const R1 = trim_(p.R1), R2 = trim_(p.R2), R3 = trim_(p.R3), R4 = trim_(p.R4), R5 = trim_(p.R5);
  const hit = findWishlistRow_(who);

  const shW = sh_('Wishlists');
  shW.getRange(hit.rowIndex, 1, 1, 6).setValues([[who, R1, R2, R3, R4, R5]]);
  return { ok:true };
}

function getHistory_(p){
  const limit = Math.max(1, Number(p.limit || 10));
  const shH = sh_('History');
  const lastRow = shH.getLastRow();
  const lastCol = shH.getLastColumn();
  if (lastRow < 2) return { ok:true, rows: [] };

  const headers = shH.getRange(1,1,1,lastCol).getValues()[0].map(String);
  const data = shH.getRange(2,1,lastRow-1,lastCol).getValues();

  const out = [];
  for (let i=data.length-1; i>=0 && out.length<limit; i--){
    const obj = {};
    headers.forEach((h,idx)=> obj[h] = data[i][idx]);
    out.push(obj);
  }
  return { ok:true, rows: out };
}

function getTops_(p){
  const PEOPLE = getPeople_();
  const limit = Math.max(1, Number(p.limit || 5));

  const shH = sh_('History');
  const lastRow = shH.getLastRow();
  const lastCol = shH.getLastColumn();
  if (lastRow < 2) return { ok:true, bestFilms:[], bestPickers:[] };

  const headers = shH.getRange(1,1,1,lastCol).getValues()[0].map(String);
  const data = shH.getRange(2,1,lastRow-1,lastCol).getValues();

  const idxFilm = headers.indexOf('Film');
  const idxPicker = headers.indexOf('Vem valde');

  const idxByPerson = {};
  PEOPLE.forEach(pn=> idxByPerson[pn] = headers.indexOf(pn));

  const filmStats = {};   // film -> {sum, n, who}
  const pickerStats = {}; // who  -> {sumAvg, n, films}

  data.forEach(row=>{
    const film = String(row[idxFilm] || '').trim();
    const picker = String(row[idxPicker] || '').trim();
    if (!film || !picker) return;

    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const v = Number(row[idxByPerson[pn]]);
      if (isFinite(v) && v>0){ sum += v; n++; }
    });
    if (n <= 0) return;

    const avg = sum / n;

    if (!filmStats[film]) filmStats[film] = { sum:0, n:0, who: picker };
    filmStats[film].sum += avg;
    filmStats[film].n += 1;
    filmStats[film].who = picker;

    if (!pickerStats[picker]) pickerStats[picker] = { sumAvg:0, n:0, films:0 };
    pickerStats[picker].sumAvg += avg;
    pickerStats[picker].n += 1;
    pickerStats[picker].films += 1;
  });

  const bestFilms = Object.keys(filmStats).map(f=>({
    film: f,
    avg: Math.round((filmStats[f].sum / filmStats[f].n) * 10) / 10,
    who: filmStats[f].who
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  const bestPickers = Object.keys(pickerStats).map(w=>({
    who: w,
    avg: Math.round((pickerStats[w].sumAvg / pickerStats[w].n) * 10) / 10,
    n: pickerStats[w].films
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  return { ok:true, bestFilms: bestFilms, bestPickers: bestPickers };
}

function skipNext_(){
  const PEOPLE = getPeople_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok:false, error:'lock timeout' };
  try{
    let idx = Number(getConfig_('nextIndex') || '0');
    idx = ((idx % PEOPLE.length) + PEOPLE.length) % PEOPLE.length;
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
  if (!lock.tryLock(12000)) return { ok:false, error:'lock timeout' };

  try{
    // Läs scores
    const scores = getScores_().scores || {};

    // Skriv History
    const shH = sh_('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0].map(String);
    const row = headers.map(h=>{
      if (h === 'Datum') return today_();
      if (h === 'Film') return film;
      if (h === 'Vem valde') return who;
      if (h === 'Kommentar') return comment;
      if (PEOPLE.indexOf(h) >= 0) return toNumOrBlank_(scores[h]);
      return '';
    });
    shH.appendRow(row);

    // Rensa scores
    const shS = sh_('Scores');
    shS.getRange(2,1,1,PEOPLE.length).setValues([PEOPLE.map(_=>'')]);

    // Flytta upp wishlist för den som valde (R2→R1 osv)
    const hit = findWishlistRow_(who);
    const r = hit.row;
    const newRow = [who, r[2]||'', r[3]||'', r[4]||'', r[5]||'', '' ];
    sh_('Wishlists').getRange(hit.rowIndex,1,1,6).setValues([newRow]);

    // Advance nextIndex deterministiskt: från who till nästa i PEOPLE
    const whoIdx = PEOPLE.indexOf(who);
    const nextIdx = (whoIdx >= 0) ? ((whoIdx + 1) % PEOPLE.length) : 0;
    setConfig_('nextIndex', String(nextIdx));

    return { ok:true, nextPerson: PEOPLE[nextIdx] };
  } finally {
    lock.releaseLock();
  }
}