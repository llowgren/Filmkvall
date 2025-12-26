/** =======================
 *  Filmkväll – Google Apps Script API (Code.gs)
 *  Matchar index.htm som kör GET: ?action=...&pw=Look4fun&...
 *
 *  Sheets:
 *   - Config   : Key | Value              (nextIndex, people)
 *   - Wishlists: Person | R1..R5
 *   - Scores   : Hannah | Maria | Tuva | Alva | Lars
 *   - History  : Datum | Film | Vem valde | Kommentar | Hannah | Maria | Tuva | Alva | Lars
 *  ======================= */

const TZ = 'Europe/Stockholm';
const PEOPLE_DEFAULT = ['Hannah','Maria','Tuva','Alva','Lars'];

// MÅSTE matcha din index.htm:
const PW_REQUIRED = 'Look4fun';

/** ===== HTTP entry ===== */
function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); } // ok om du råkar posta senare

function handle_(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const action = String(p.action || '').trim();
    const pw = String(p.pw || '');

    if(!action) return json_({ ok:false, error:'action required' });

    // Enkel auth (som din index.htm förväntar sig)
    if(pw !== PW_REQUIRED){
      return json_({ ok:false, error:'bad pw' });
    }

    ensureSheets_();

    switch(action){
      case 'ping':         return json_({ ok:true, time:new Date().toISOString() });

      case 'getCurrent':   return json_(getCurrent_());
      case 'getScores':    return json_(getScores_());
      case 'saveScores':   return json_(saveScores_(p));

      case 'getWishlist':  return json_(getWishlist_(p));
      case 'saveWishlist': return json_(saveWishlist_(p));

      case 'getTops':      return json_(getTops_(p));
      case 'getHistory':   return json_(getHistory_(p));

      case 'skipNext':     return json_(skipNext_());
      case 'saveNight':    return json_(saveNight_(p));

      default:
        return json_({ ok:false, error:'unknown action', got:action });
    }
  }catch(err){
    return json_({ ok:false, error:String(err) });
  }
}

/** ===== Output helper ===== */
function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ===== Sheet helpers ===== */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function getOrCreateSheet_(name){ return ss_().getSheetByName(name) || ss_().insertSheet(name); }

function today_(){
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function trim_(v){
  return String(v == null ? '' : v).trim();
}

// Jämför namn robust (tar bort extra mellanslag)
function normName_(s){
  return trim_(s).replace(/\s+/g,' ');
}

/** ===== People from Config (fallback) ===== */
function getPeople_(){
  const fromCfg = getConfig_('people');
  if(fromCfg && String(fromCfg).trim()){
    return String(fromCfg)
      .split(',')
      .map(normName_)
      .filter(Boolean);
  }
  return PEOPLE_DEFAULT.slice();
}

/** ===== Ensure sheets & headers ===== */
function ensureSheets_(){
  const PEOPLE = getPeople_();

  // Config
  const shC = getOrCreateSheet_('Config');
  if(shC.getLastRow() === 0){
    shC.getRange(1,1,1,2).setValues([['Key','Value']]);
  }
  if(getConfig_('people') === null) setConfig_('people', PEOPLE_DEFAULT.join(','));
  if(getConfig_('nextIndex') === null) setConfig_('nextIndex', '0');

  // Wishlists
  const shW = getOrCreateSheet_('Wishlists');
  if(shW.getLastRow() === 0){
    shW.getRange(1,1,1,6).setValues([['Person','R1','R2','R3','R4','R5']]);
    shW.getRange(2,1,PEOPLE.length,6).setValues(PEOPLE.map(p=>[p,'','','','','']));
  }else{
    // Se till att alla PEOPLE finns (och normalisera ev. mellanslag i Person-kolumnen)
    const last = shW.getLastRow();
    if(last >= 2){
      const col = shW.getRange(2,1,last-1,1).getValues().map(r=>normName_(r[0]));
      // Normalisera i sheet om det finns trailing spaces
      for(let i=0;i<col.length;i++){
        const raw = shW.getRange(i+2,1).getValue();
        const n = normName_(raw);
        if(String(raw) !== n) shW.getRange(i+2,1).setValue(n);
      }
      const existingSet = new Set(col);
      PEOPLE.forEach(p=>{
        if(!existingSet.has(p)){
          shW.appendRow([p,'','','','','']);
        }
      });
    }
  }

  // Scores
  const shS = getOrCreateSheet_('Scores');
  const headS = PEOPLE.slice();
  if(shS.getLastRow() === 0){
    shS.getRange(1,1,1,headS.length).setValues([headS]);
    shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
  }else{
    const h = shS.getRange(1,1,1,shS.getLastColumn()).getValues()[0].map(normName_);
    if(h.join('|') !== headS.join('|')){
      shS.clear();
      shS.getRange(1,1,1,headS.length).setValues([headS]);
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }else if(shS.getLastRow() < 2){
      shS.getRange(2,1,1,headS.length).setValues([headS.map(_=>'')]);
    }
  }

  // History
  const shH = getOrCreateSheet_('History');
  const headH = ['Datum','Film','Vem valde','Kommentar'].concat(PEOPLE);
  if(shH.getLastRow() === 0){
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  }else{
    const lastCol = shH.getLastColumn();
    const h = shH.getRange(1,1,1,lastCol).getValues()[0];
    // Expand columns if needed and enforce correct header
    if(lastCol < headH.length){
      shH.insertColumnsAfter(lastCol, headH.length - lastCol);
    }
    shH.getRange(1,1,1,headH.length).setValues([headH]);
  }
}

/** ===== Config get/set ===== */
function getConfig_(key){
  const sh = ss_().getSheetByName('Config');
  const last = sh.getLastRow();
  if(last < 2) return null;
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for(const [k,v] of rows){
    if(String(k) === String(key)) return v;
  }
  return null;
}

function setConfig_(key,value){
  const sh = ss_().getSheetByName('Config');
  if(sh.getLastRow() < 1){
    sh.getRange(1,1,1,2).setValues([['Key','Value']]);
  }
  const last = sh.getLastRow();
  if(last < 2){
    sh.appendRow([key,value]);
    return;
  }
  const rows = sh.getRange(2,1,last-1,2).getValues();
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]) === String(key)){
      sh.getRange(i+2,2).setValue(value);
      return;
    }
  }
  sh.appendRow([key,value]);
}

/** ===== Actions ===== */
function getCurrent_(){
  const PEOPLE = getPeople_();
  let idx = Number(getConfig_('nextIndex') || '0');
  if(!isFinite(idx) || idx < 0) idx = 0;
  idx = idx % PEOPLE.length;

  const who = PEOPLE[idx];

  // Här är viktiga raden: suggestion ska vara R1 för "who"
  const wl = getWishlist_({ person: who });
  const suggestion = wl && wl.ok ? (wl.R1 || '') : '';

  const scores = getScores_().scores || {};
  return { ok:true, next:who, suggestion, scores };
}

function getScores_(){
  const PEOPLE = getPeople_();
  const sh = ss_().getSheetByName('Scores');
  const headers = sh.getRange(1,1,1,PEOPLE.length).getValues()[0].map(normName_);
  const row = sh.getRange(2,1,1,PEOPLE.length).getValues()[0];

  const scores = {};
  headers.forEach((h,i)=> scores[h] = (row[i] === '' || row[i] == null) ? '' : row[i]);
  return { ok:true, scores };
}

function saveScores_(p){
  const PEOPLE = getPeople_();
  let incoming = {};
  try{
    incoming = p.scores ? JSON.parse(p.scores) : {};
  }catch(_){
    return { ok:false, error:'bad scores json' };
  }

  const sh = ss_().getSheetByName('Scores');
  const headers = sh.getRange(1,1,1,PEOPLE.length).getValues()[0].map(normName_);
  const row = sh.getRange(2,1,1,PEOPLE.length).getValues()[0];

  headers.forEach((h,i)=>{
    if(Object.prototype.hasOwnProperty.call(incoming,h)){
      const v = incoming[h];
      // front skickar '' eller '1'..'10'
      row[i] = (v === '' || v == null) ? '' : Number(v);
      if(row[i] !== '' && !isFinite(row[i])) row[i] = '';
    }
  });

  sh.getRange(2,1,1,PEOPLE.length).setValues([row]);
  return { ok:true };
}

function getWishlist_(p){
  const who = normName_(p && p.person);
  if(!who) return { ok:false, error:'person required' };

  const sh = ss_().getSheetByName('Wishlists');
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };

  const vals = sh.getRange(2,1,lastRow-1,6).getValues();
  for(let r=0;r<vals.length;r++){
    const nameInSheet = normName_(vals[r][0]);
    if(nameInSheet === who){
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

  // Om saknas: skapa rad
  sh.appendRow([who,'','','','','']);
  return { ok:true, R1:'',R2:'',R3:'',R4:'',R5:'' };
}

function saveWishlist_(p){
  const who = normName_(p && p.person);
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
    const nameInSheet = normName_(vals[r][0]);
    if(nameInSheet === who){
      // Skriv även normaliserat namn tillbaka
      sh.getRange(r+2,1).setValue(who);
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
  PEOPLE.forEach(pn => idxByPerson[pn] = headers.indexOf(pn));

  // Bästa filmer (snitt av snitt)
  const filmStats = {};
  data.forEach(row=>{
    const film = trim_(row[idxFilm]);
    if(!film) return;

    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const v = Number(row[idxByPerson[pn]]);
      if(isFinite(v) && v>0){ sum += v; n++; }
    });
    if(n<=0) return;

    if(!filmStats[film]) filmStats[film] = { sumAvg:0, n:0, who:'' };
    filmStats[film].sumAvg += (sum/n);
    filmStats[film].n += 1;
    filmStats[film].who = trim_(row[idxPicker]);
  });

  const bestFilms = Object.keys(filmStats).map(f=>({
    film: f,
    avg: Math.round((filmStats[f].sumAvg / filmStats[f].n) * 10) / 10,
    who: filmStats[f].who
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  // Bästa väljare
  const pickerStats = {};
  data.forEach(row=>{
    const picker = normName_(row[idxPicker]);
    if(!picker) return;

    let sum=0, n=0;
    PEOPLE.forEach(pn=>{
      const v = Number(row[idxByPerson[pn]]);
      if(isFinite(v) && v>0){ sum += v; n++; }
    });
    if(n<=0) return;

    if(!pickerStats[picker]) pickerStats[picker] = { sumAvg:0, n:0, films:0 };
    pickerStats[picker].sumAvg += (sum/n);
    pickerStats[picker].n += 1;
    pickerStats[picker].films += 1;
  });

  const bestPickers = Object.keys(pickerStats).map(w=>({
    who: w,
    avg: Math.round((pickerStats[w].sumAvg / pickerStats[w].n) * 10) / 10,
    n: pickerStats[w].films
  })).sort((a,b)=> b.avg - a.avg).slice(0, limit);

  return { ok:true, bestFilms, bestPickers };
}

function skipNext_(){
  const PEOPLE = getPeople_();
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(8000)) return { ok:false, error:'lock timeout' };

  try{
    let idx = Number(getConfig_('nextIndex') || '0');
    if(!isFinite(idx) || idx < 0) idx = 0;
    idx = (idx + 1) % PEOPLE.length;
    setConfig_('nextIndex', String(idx));
    return { ok:true, next: PEOPLE[idx] };
  }finally{
    lock.releaseLock();
  }
}

function saveNight_(p){
  const PEOPLE = getPeople_();

  const who = normName_(p.who);
  const film = trim_(p.film);
  const comment = trim_(p.comment);

  if(!who || !film) return { ok:false, error:'who and film required' };

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) return { ok:false, error:'lock timeout' };

  try{
    // Läs aktuella scores
    const scoresObj = getScores_().scores || {};

    // Skriv till History
    const shH = ss_().getSheetByName('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];

    const row = headers.map(h=>{
      if(h === 'Datum') return today_();
      if(h === 'Film') return film;
      if(h === 'Vem valde') return who;
      if(h === 'Kommentar') return comment;
      if(PEOPLE.indexOf(h) >= 0){
        const v = Number(scoresObj[h]);
        return (isFinite(v) && v>0) ? v : '';
      }
      return '';
    });

    shH.appendRow(row);

    // Nollställ scores
    const shS = ss_().getSheetByName('Scores');
    shS.getRange(2,1,1,PEOPLE.length).setValues([PEOPLE.map(_=>'')]);

    // Flytta upp wishlist för den som valde (R2->R1, osv)
    const shW = ss_().getSheetByName('Wishlists');
    const lastRow = shW.getLastRow();
    if(lastRow >= 2){
      const vals = shW.getRange(2,1,lastRow-1,6).getValues();
      for(let r=0;r<vals.length;r++){
        if(normName_(vals[r][0]) === who){
          const newRow = [who, vals[r][2]||'', vals[r][3]||'', vals[r][4]||'', vals[r][5]||'', '' ];
          shW.getRange(r+2,1,1,6).setValues([newRow]);
          break;
        }
      }
    }

    // Advance turn deterministiskt: nästa efter who i PEOPLE-ordningen
    const whoIdx = PEOPLE.indexOf(who);
    const nextIdx = (whoIdx >= 0) ? (whoIdx + 1) % PEOPLE.length : 0;
    setConfig_('nextIndex', String(nextIdx));

    return { ok:true, nextPerson: PEOPLE[nextIdx] };
  }finally{
    lock.releaseLock();
  }
}