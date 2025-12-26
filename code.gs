/** =======================
 *  Filmkväll – Google Apps Script API (Code.gs)
 *  Passar din index.htm (GET med action + pw)
 *
 *  Blad:
 *   - Config   : Key | Value              (people, nextIndex)
 *   - Wishlists: Person | R1..R5
 *   - Scores   : Hannah | Maria | Tuva | Alva | Lars   (rad 2)
 *   - History  : Datum | Film | Vem valde | Kommentar | Hannah | Maria | Tuva | Alva | Lars
 *
 *  Auth:
 *   - Frontend skickar pw=Look4fun
 *   - Sätt Script Property "PW" om du vill (annars används 'Look4fun' som default)
 *  =======================
 */

const TZ = 'Europe/Stockholm';
const PEOPLE_DEFAULT = ['Hannah','Maria','Tuva','Alva','Lars'];
const DEFAULT_PW = 'Look4fun'; // matchar din index.htm

/** ===== Entrypoints ===== */
function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); } // funkar även om du råkar POST:a

function handle_(e){
  try{
    const p = getParams_(e);
    const action = String(p.action || '').trim();
    if(!action) return json_({ ok:false, error:'action required' });

    // Enkel auth: kräver pw för ALLA actions (som din frontend alltid skickar)
    const pw = String(p.pw || '').trim();
    if(!secureEq_(pw, getPw_())) return json_({ ok:false, error:'bad auth' });

    ensureSheets_();

    switch(action){
      case 'ping':        return json_({ ok:true, time:new Date().toISOString() });

      case 'getCurrent':  return json_(getCurrent_());
      case 'getScores':   return json_(getScores_());
      case 'saveScores':  return json_(saveScores_(p));

      case 'getWishlist': return json_(getWishlist_(p));
      case 'saveWishlist':return json_(saveWishlist_(p));

      case 'getHistory':  return json_(getHistory_(p));
      case 'getTops':     return json_(getTops_(p));

      case 'skipNext':    return json_(skipNext_());
      case 'saveNight':   return json_(saveNight_(p));

      default:
        return json_({ ok:false, error:'unknown action', got:action });
    }
  }catch(err){
    return json_({ ok:false, error:String(err) });
  }
}

/** ===== Params ===== */
function getParams_(e){
  // Apps Script fyller e.parameter för querystring OCH x-www-form-urlencoded POST
  const base = (e && e.parameter) ? e.parameter : {};
  const out = {};
  Object.keys(base).forEach(k => out[k] = base[k]);

  // Om någon skickar JSON body
  if (e && e.postData && typeof e.postData.contents === 'string' && e.postData.contents) {
    const ct = String(e.postData.type || e.postData.contentType || '').toLowerCase();
    if (ct.indexOf('application/json') >= 0) {
      try {
        const obj = JSON.parse(e.postData.contents);
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach(k => { if(!(k in out)) out[k] = obj[k]; });
        }
      } catch (_) {}
    }
  }
  return out;
}

/** ===== JSON ===== */
function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ===== Security ===== */
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
  // Script Property PW om du vill. Annars DEFAULT_PW.
  const v = PropertiesService.getScriptProperties().getProperty('PW');
  const pw = (v && String(v).trim()) ? String(v).trim() : DEFAULT_PW;
  return pw;
}

/** ===== Spreadsheet helpers ===== */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(name){ return ss_().getSheetByName(name) || ss_().insertSheet(name); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function trim_(v){ return String(v == null ? '' : v).trim(); }
function toNumOrBlank_(v){
  // Frontend skickar '' eller '1'..'10'
  const s = String(v == null ? '' : v).trim();
  if(s === '') return '';
  const n = Number(s);
  return isFinite(n) ? n : '';
}

/** ===== Config ===== */
function getConfig_(key){
  const sh = ss_().getSheetByName('Config');
  if(!sh) return null;
  const last = sh.getLastRow();
  if(last < 2) return null;
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for (const [k,v] of rows){
    if(String(k) === String(key)) return v;
  }
  return null;
}

function setConfig_(key, value){
  const sh = sh_('Config');
  if(sh.getLastRow() === 0) sh.getRange(1,1,1,2).setValues([['Key','Value']]);

  const last = sh.getLastRow();
  if(last < 2){
    sh.appendRow([key, value]);
    return;
  }
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]) === String(key)){
      sh.getRange(i+2,2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function getPeople_(){
  const fromCfg = getConfig_('people');
  if(fromCfg && String(fromCfg).trim()){
    return String(fromCfg).split(',').map(s=>s.trim()).filter(Boolean);
  }
  return PEOPLE_DEFAULT.slice();
}

/** ===== Ensure schema ===== */
function ensureSheets_(){
  const PEOPLE = getPeople_();

  // Config
  const shC = sh_('Config');
  if(shC.getLastRow() === 0) shC.getRange(1,1,1,2).setValues([['Key','Value']]);
  if(getConfig_('people') == null) setConfig_('people', PEOPLE_DEFAULT.join(','));
  if(getConfig_('nextIndex') == null) setConfig_('nextIndex', '0');

  // Wishlists
  const shW = sh_('Wishlists');
  const wlHeader = ['Person','R1','R2','R3','R4','R5'];
  if(shW.getLastRow() === 0){
    shW.getRange(1,1,1,6).setValues([wlHeader]);
    shW.getRange(2,1,PEOPLE.length,6).setValues(PEOPLE.map(p=>[p,'','','','','']));
  }else{
    // säkerställ header
    const h = shW.getRange(1,1,1,Math.max(6, shW.getLastColumn())).getValues()[0].slice(0,6);
    if(h.join('|') !== wlHeader.join('|')){
      if(shW.getLastColumn() < 6) shW.insertColumnsAfter(shW.getLastColumn(), 6 - shW.getLastColumn());
      shW.getRange(1,1,1,6).setValues([wlHeader]);
    }
    // säkerställ rader för alla personer
    const existing = shW.getRange(2,1,Math.max(0, shW.getLastRow()-1),1).getValues().flat().map(String);
    PEOPLE.forEach(p=>{ if(!existing.includes(p)) shW.appendRow([p,'','','','','']); });
  }

  // Scores
  const shS = sh_('Scores');
  const headS = PEOPLE.slice();
  if(shS.getLastRow() === 0){
    shS.getRange(1,1,1,headS.length).setValues([headS]);
    shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
  }else{
    const h = shS.getRange(1,1,1,shS.getLastColumn()).getValues()[0];
    if(h.join('|') !== headS.join('|')){
      shS.clear();
      shS.getRange(1,1,1,headS.length).setValues([headS]);
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }else if(shS.getLastRow() < 2){
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }
  }

  // History
  const shH = sh_('History');
  const headH = ['Datum','Film','Vem valde','Kommentar'].concat(PEOPLE);
  if(shH.getLastRow() === 0){
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  }else{
    if(shH.getLastColumn() < headH.length){
      shH.insertColumnsAfter(shH.getLastColumn(), headH.length - shH.getLastColumn());
    }
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  }
}

/** ===== Actions ===== */
function getCurrent_(){
  const PEOPLE = getPeople_();
  const idx = Number(getConfig_('nextIndex') || '0') % PEOPLE.length;
  const who = PEOPLE[idx];

  // suggestion = R1 för den som är på tur
  const wl = getWishlist_({ person: who });
  const suggestion = wl.ok ? (wl.R1 || '') : '';

  const scores = getScores_().scores || {};
  return { ok:true, next:who, suggestion, scores };
}

function getScores_(){
  const PEOPLE = getPeople_();
  const sh = ss_().getSheetByName('Scores');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const row = sh.getRange(2,1,1,headers.length).getValues()[0];
  const scores = {};
  headers.forEach((h,i)=> scores[h] = row[i] === '' ? '' : row[i]);
  // om någon kolumn saknas (ska inte hända efter ensureSheets) – fyll ändå
  PEOPLE.forEach(p=>{ if(!(p in scores)) scores[p] = ''; });
  return { ok:true, scores };
}

function saveScores_(p){
  // Frontend skickar scores som JSON-string: {"Hannah":"7"} eller {"Hannah":""}
  let incoming = {};
  try{
    incoming = p.scores ? JSON.parse(p.scores) : {};
  }catch(_){
    return { ok:false, error:'scores must be JSON' };
  }

  const sh = ss_().getSheetByName('Scores');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const row = sh.getRange(2,1,1,headers.length).getValues()[0];

  headers.forEach((h,i)=>{
    if(Object.prototype.hasOwnProperty.call(incoming, h)){
      row[i] = toNumOrBlank_(incoming[h]);
    }
  });

  sh.getRange(2,1,1,headers.length).setValues([row]);
  return { ok:true };
}

function getWishlist_(p){
  const who = trim_(p.person);
  if(!who) return { ok:false, error:'person required' };

  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };

  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for(let r=0;r<vals.length;r++){
    if(String(vals[r][0]) === who){
      return {
        ok:true,
        R1: vals[r][1] || '',
        R2: vals[r][2] || '',
        R3: vals[r][3] || '',
        R4: vals[r][4] || '',
        R5: vals[r][5] || ''
      };
    }
  }

  // om person saknas: lägg till
  sh.appendRow([who,'','','','','']);
  return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
}

function saveWishlist_(p){
  const who = trim_(p.person);
  if(!who) return { ok:false, error:'person required' };

  const R1 = trim_(p.R1), R2 = trim_(p.R2), R3 = trim_(p.R3), R4 = trim_(p.R4), R5 = trim_(p.R5);

  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if(lastRow < 2){
    sh.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    sh.appendRow([who,R1,R2,R3,R4,R5]);
    return { ok:true };
  }

  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for(let r=0;r<vals.length;r++){
    if(String(vals[r][0]) === who){
      sh.getRange(r+2,2,1,5).setValues([[R1,R2,R3,R4,R5]]);
      return { ok:true };
    }
  }

  sh.appendRow([who,R1,R2,R3,R4,R5]);
  return { ok:true };
}

function getHistory_(p){
  const limit = Math.max(1, Number(p.limit || 10));
  const sh = ss_().getSheetByName('History');
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if(lastRow < 2) return { ok:true, rows:[] };

  const headers = sh.getRange(1,1,1,lastCol).getValues()[0];
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();

  const out = [];
  for(let i=data.length-1; i>=0 && out.length<limit; i--){
    const obj = {};
    headers.forEach((h,idx)=> obj[h] = data[i][idx]);
    out.push(obj);
  }
  return { ok:true, rows: out };
}

function getTops_(p){
  const PEOPLE = getPeople_();
  const limit = Math.max(1, Number(p.limit || 5));

  const sh = ss_().getSheetByName('History');
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if(lastRow < 2) return { ok:true, bestFilms:[], bestPickers:[] };

  const headers = sh.getRange(1,1,1,lastCol).getValues()[0];
  const data = sh.getRange(2,1,lastRow-1,lastCol).getValues();

  const idxFilm = headers.indexOf('Film');
  const idxPicker = headers.indexOf('Vem valde');
  const idxByPerson = {};
  PEOPLE.forEach(pn=> idxByPerson[pn] = headers.indexOf(pn));

  // Film stats: medel av medel (per kväll)
  const filmStats = {};
  data.forEach(row=>{
    const film = String(row[idxFilm] || '').trim();
    if(!film) return;

    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const ix = idxByPerson[pn];
      if(ix < 0) return;
      const v = Number(row[ix]);
      if(isFinite(v) && v>0){ sum += v; n++; }
    });
    if(n <= 0) return;

    if(!filmStats[film]) filmStats[film] = { sumAvg:0, n:0, who:String(row[idxPicker]||'') };
    filmStats[film].sumAvg += (sum/n);
    filmStats[film].n += 1;
    filmStats[film].who = String(row[idxPicker]||'');
  });

  const bestFilms = Object.keys(filmStats).map(f=>({
    film: f,
    avg: Math.round((filmStats[f].sumAvg / filmStats[f].n)*10)/10,
    who: filmStats[f].who
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  // Picker stats: medel av kvällars snitt + antal filmer
  const pickerStats = {};
  data.forEach(row=>{
    const picker = String(row[idxPicker] || '').trim();
    if(!picker) return;

    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const ix = idxByPerson[pn];
      if(ix < 0) return;
      const v = Number(row[ix]);
      if(isFinite(v) && v>0){ sum += v; n++; }
    });
    if(n <= 0) return;

    if(!pickerStats[picker]) pickerStats[picker] = { sumAvg:0, n:0, films:0 };
    pickerStats[picker].sumAvg += (sum/n);
    pickerStats[picker].n += 1;
    pickerStats[picker].films += 1;
  });

  const bestPickers = Object.keys(pickerStats).map(w=>({
    who: w,
    avg: Math.round((pickerStats[w].sumAvg / pickerStats[w].n)*10)/10,
    n: pickerStats[w].films
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  return { ok:true, bestFilms, bestPickers };
}

function skipNext_(){
  const PEOPLE = getPeople_();
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(5000)) return { ok:false, error:'lock timeout' };
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

  if(!who || !film) return { ok:false, error:'who and film required' };

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) return { ok:false, error:'lock timeout' };

  try{
    // Hämta aktuella scores
    const scores = (getScores_().scores || {});

    // Skriv historikrad
    const shH = ss_().getSheetByName('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    const row = [];

    headers.forEach(h=>{
      if(h === 'Datum') row.push(today_());
      else if(h === 'Film') row.push(film);
      else if(h === 'Vem valde') row.push(who);
      else if(h === 'Kommentar') row.push(comment);
      else if(PEOPLE.indexOf(h) >= 0) row.push(toNumOrBlank_(scores[h]));
      else row.push('');
    });

    shH.appendRow(row);

    // Rensa scores (rad 2)
    const shS = ss_().getSheetByName('Scores');
    shS.getRange(2,1,1,PEOPLE.length).setValues([PEOPLE.map(_=>'')]);

    // Skifta wishlist upp för den som valde (R2->R1 osv)
    const shW = ss_().getSheetByName('Wishlists');
    const lastRow = shW.getLastRow();
    if(lastRow >= 2){
      const vals = shW.getRange(2,1,lastRow-1,6).getValues();
      for(let r=0;r<vals.length;r++){
        if(String(vals[r][0]) === who){
          const newRow = [who, vals[r][2]||'', vals[r][3]||'', vals[r][4]||'', vals[r][5]||'', '' ];
          shW.getRange(r+2,1,1,6).setValues([newRow]);
          break;
        }
      }
    }

    // Sätt nextIndex deterministiskt baserat på "who"
    const whoIdx = PEOPLE.indexOf(who);
    const nextIdx = (whoIdx >= 0) ? (whoIdx + 1) % PEOPLE.length : (Number(getConfig_('nextIndex')||'0')+1) % PEOPLE.length;
    setConfig_('nextIndex', String(nextIdx));

    return { ok:true, nextPerson: PEOPLE[nextIdx] };
  } finally {
    lock.releaseLock();
  }
}