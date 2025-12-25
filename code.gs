/** =======================
 *  Filmkväll – Google Apps Script API (code.gs)
 *  Blad:
 *   - Config   : Key | Value              (nextIndex, people)
 *   - Wishlists: Person | R1..R5
 *   - Scores   : Hannah | Maria | Tuva | Alva | Lars
 *   - History  : Datum | Film | Vem valde | Kommentar | Hannah | Maria | Tuva | Alva | Lars
 *  ======================= */
const PW = 'Look4fun';
const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];
const TZ = 'Europe/Stockholm';

/** ===== HTTP entry ===== */
function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); }

function handle_(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const action = String(p.action || '').trim();  // <- robust
    if (action !== 'ping') {
      if ((p.pw || '') !== PW) return json_({ ok:false, error:'bad pw' });
    }
    ensureSheets_();

    switch (action) {
      case 'ping':        return json_({ ok:true, time:new Date().toISOString() });
      case 'debug':       return json_({ ok:true, received:p }); // <- ny, för felsökning
      case 'getCurrent':  return json_(getCurrent_());
      case 'getScores':   return json_(getScores_());
      case 'saveScores':  return json_(saveScores_(p));
      case 'getWishlist': return json_(getWishlist_(p));
      case 'saveWishlist':return json_(saveWishlist_(p));
      case 'getTops':     return json_(getTops_(p));
      case 'getHistory':  return json_(getHistory_(p));
      case 'skipNext':    return json_(skipNext_());
      case 'saveNight':   return json_(saveNight_(p));
      default:            return json_({ ok:false, error:'unknown action', got:action });
    }
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

/** ===== Helpers ===== */
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function getOrCreateSheet_(name){ return ss_().getSheetByName(name) || ss_().insertSheet(name); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function toNum_(v){ const n = Number(v); return isFinite(n) ? n : ''; }

/** ===== Ensure sheets & headers ===== */
function ensureSheets_(){
  // Config
  const shC = getOrCreateSheet_('Config');
  if (shC.getLastRow() === 0) shC.getRange(1,1,1,2).setValues([['Key','Value']]);
  if (getConfig_('people') === null) setConfig_('people', PEOPLE.join(','));
  if (getConfig_('nextIndex') === null) setConfig_('nextIndex', '0');

  // Wishlists
  const shW = getOrCreateSheet_('Wishlists');
  if (shW.getLastRow() === 0){
    shW.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    shW.getRange(2,1,PEOPLE.length,6).setValues(PEOPLE.map(p=>[p,'','','','','']));
  } else {
    const existing = shW.getRange(2,1,Math.max(0,shW.getLastRow()-1),1).getValues().flat().map(String);
    PEOPLE.forEach(p=>{ if (!existing.includes(p)) shW.appendRow([p,'','','','','']); });
  }

  // Scores
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

  // History
  const shH = getOrCreateSheet_('History');
  const headH = ['Datum','Film','Vem valde','Kommentar'].concat(PEOPLE);
  if (shH.getLastRow() === 0){
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  } else {
    const h = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    if (h.join('|') !== headH.join('|')){
      if (shH.getLastColumn() < headH.length) shH.insertColumnsAfter(shH.getLastColumn(), headH.length - shH.getLastColumn());
      shH.getRange(1,1,1,headH.length).setValues([headH]);
    }
  }
}

/** ===== Config get/set ===== */
function getConfig_(key){
  const sh = ss_().getSheetByName('Config');
  const rng = sh.getRange(1,1,sh.getLastRow(),2).getValues();
  for (let r=2;r<=rng.length;r++) if (rng[r-1][0] === key) return rng[r-1][1];
  return null;
}
function setConfig_(key,value){
  const sh = ss_().getSheetByName('Config');
  const last = sh.getLastRow();
  if (last < 2){
    sh.appendRow(['nextIndex','0']);
    sh.appendRow(['people', PEOPLE.join(',')]);
  }
  const rng = sh.getRange(1,1,sh.getLastRow(),2).getValues();
  for (let r=2;r<=rng.length;r++){
    if (rng[r-1][0] === key){ sh.getRange(r,2).setValue(value); return; }
  }
  sh.appendRow([key,value]);
}

/** ===== Actions ===== */
function getCurrent_(){
  const idx = Number(getConfig_('nextIndex') || '0') % PEOPLE.length;
  const who = PEOPLE[idx];
  const suggestion = getWishlist_({ person: who }).R1 || '';
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
    const incoming = p.scores ? JSON.parse(p.scores) : {};
    const sh = ss_().getSheetByName('Scores');
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(2,1,1,headers.length).getValues()[0];
    headers.forEach((h,i)=>{ if (Object.prototype.hasOwnProperty.call(incoming,h)) row[i] = incoming[h]; });
    sh.getRange(2,1,1,headers.length).setValues([row]);
    return { ok:true };
  } catch(e){
    return { ok:false, error:String(e) };
  }
}

function getWishlist_(p){
  const who = String(p.person||'').trim();
  if (!who) return { ok:false, error:'person required' };
  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for (let r=0;r<vals.length;r++){
    if (String(vals[r][0]) === who) return { ok:true, R1:vals[r][1]||'', R2:vals[r][2]||'', R3:vals[r][3]||'', R4:vals[r][4]||'', R5:vals[r][5]||'' };
  }
  sh.appendRow([who,'','','','','']);
  return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
}

function saveWishlist_(p){
  const who = String(p.person||'').trim();
  if (!who) return { ok:false, error:'person required' };
  const R1 = p.R1||'', R2=p.R2||'', R3=p.R3||'', R4=p.R4||'', R5=p.R5||'';
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
    film:f, avg: Math.round((filmStats[f].sum/filmStats[f].n)*10)/10, who:filmStats[f].who
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
    who:w, avg: Math.round((pickerStats[w].sumAvg/pickerStats[w].n)*10)/10, n: pickerStats[w].films
  })).sort((a,b)=> b.avg - a.avg).slice(0,limit);

  return { ok:true, bestFilms, bestPickers };
}

function skipNext_(){
  const lock = LockService.getScriptLock(); lock.tryLock(5000);
  try{
    let idx = Number(getConfig_('nextIndex') || '0') % PEOPLE.length;
    idx = (idx + 1) % PEOPLE.length;
    setConfig_('nextIndex', String(idx));
    return { ok:true, next: PEOPLE[idx] };
  } finally { lock.releaseLock(); }
}

function saveNight_(p){
  const who = String(p.who||'').trim();
  const film = String(p.film||'').trim();
  const comment = String(p.comment||'').trim();
  if (!who || !film) return { ok:false, error:'who and film required' };

  const lock = LockService.getScriptLock(); lock.tryLock(10000);
  try{
    const scores = getScores_().scores || {};

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
    const nextIdx = whoIdx >= 0 ? (whoIdx+1)%PEOPLE.length : (Number(getConfig_('nextIndex')||'0')+1)%PEOPLE.length;
    setConfig_('nextIndex', String(nextIdx));
    return { ok:true, nextPerson: PEOPLE[nextIdx] };
  } finally { lock.releaseLock(); }
}
