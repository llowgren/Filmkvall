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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// MÅSTE matcha din index.htm:
const PW_REQUIRED = 'Look4fun';

/** ===== HTTP entry ===== */
function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); } // ok om du råkar posta senare

function handle_(e){
  try{
    const p = (e && e.parameter) ? e.parameter : {};
    const path = String((e && e.pathInfo) || '').replace(/^\/+/, '');
    if(path.indexOf('rate/') === 0){
      ensureSheets_();
      const token = path.slice('rate/'.length);
      return rateByToken_(token, p.rating);
    }

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
      case 'saveUserEmail': return json_(saveUserEmail_(p));

      case 'getWishlist':  return json_(getWishlist_(p));
      case 'saveWishlist': return json_(saveWishlist_(p));

      case 'getTops':      return json_(getTops_(p));
      case 'getHistory':   return json_(getHistory_(p));

      case 'skipNext':     return json_(skipNext_());
      case 'startNight':   return json_(startNight_(p));
      case 'saveNight':    return json_(saveNight_(p));
      case 'sendTestRatingEmail': return json_(sendTestRatingEmail_(p));
      case 'sendTestRatingEmails': return json_(sendTestRatingEmails_(p));

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

function html_(title, body){
  const safeTitle = escapeHtml_(title || 'Filmkväll');
  const safeBody = String(body || '');
  return HtmlService
    .createHtmlOutput(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:32px;line-height:1.5;color:#111}main{max-width:680px;margin:auto}.msg{font-size:20px}</style></head><body><main>${safeBody}</main></body></html>`)
    .setTitle(safeTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
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

  // Users: privat kontaktdata. Returneras aldrig av publika list-/historik-API:er.
  const shU = getOrCreateSheet_('Users');
  const headU = ['Person','Email','UpdatedAt'];
  if(shU.getLastRow() === 0){
    shU.getRange(1,1,1,headU.length).setValues([headU]);
    shU.getRange(2,1,PEOPLE.length,headU.length).setValues(PEOPLE.map(p=>[p,'','']));
  }else{
    if(shU.getLastColumn() < headU.length){
      shU.insertColumnsAfter(shU.getLastColumn(), headU.length - shU.getLastColumn());
    }
    shU.getRange(1,1,1,headU.length).setValues([headU]);
    const last = shU.getLastRow();
    const existing = last >= 2
      ? shU.getRange(2,1,last-1,1).getValues().map(r=>normName_(r[0]))
      : [];
    const existingSet = new Set(existing);
    PEOPLE.forEach(p=>{
      if(!existingSet.has(p)) shU.appendRow([p,'','']);
    });
  }

  // RatingTokens: en slumpad token per användare och film/historikrad.
  const shR = getOrCreateSheet_('RatingTokens');
  const headR = ['Token','HistoryRow','Date','Film','Person','Rating','RatedAt','CreatedAt'];
  if(shR.getLastRow() === 0){
    shR.getRange(1,1,1,headR.length).setValues([headR]);
  }else{
    if(shR.getLastColumn() < headR.length){
      shR.insertColumnsAfter(shR.getLastColumn(), headR.length - shR.getLastColumn());
    }
    shR.getRange(1,1,1,headR.length).setValues([headR]);
  }

  // Development-läge: lokala mejl utan klartextadress.
  const shD = getOrCreateSheet_('DevEmails');
  const headD = ['CreatedAt','Mode','Recipient','Person','Film','Subject','Text','Html'];
  if(shD.getLastRow() === 0){
    shD.getRange(1,1,1,headD.length).setValues([headD]);
  }else{
    if(shD.getLastColumn() < headD.length){
      shD.insertColumnsAfter(shD.getLastColumn(), headD.length - shD.getLastColumn());
    }
    shD.getRange(1,1,1,headD.length).setValues([headD]);
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

/** ===== Env / email helpers ===== */
function getEnv_(key, fallback){
  try{
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
  }catch(_){
    return fallback;
  }
}

function envBool_(key, fallback){
  const raw = String(getEnv_(key, fallback ? 'true' : 'false')).trim().toLowerCase();
  return ['1','true','yes','ja','on'].indexOf(raw) >= 0;
}

function configureMailForSend(){
  const url = 'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';
  PropertiesService.getScriptProperties().setProperties({
    MAIL_PROVIDER: 'mailapp',
    EMAIL_MODE: 'send',
    MAIL_FROM_NAME: 'Filmkväll',
    APP_BASE_URL: url,
    TEST_MOVIES_ENABLED: 'true',
    TEST_MOVIE_TITLE: 'Testet'
  }, false);
  return {
    MAIL_PROVIDER: getEnv_('MAIL_PROVIDER', ''),
    EMAIL_MODE: getEnv_('EMAIL_MODE', ''),
    MAIL_FROM_NAME: getEnv_('MAIL_FROM_NAME', ''),
    APP_BASE_URL: getEnv_('APP_BASE_URL', ''),
    TEST_MOVIES_ENABLED: getEnv_('TEST_MOVIES_ENABLED', '')
  };
}

function authorizeMailApp(){
  return MailApp.getRemainingDailyQuota();
}

function isValidEmail_(email){
  const e = trim_(email);
  return e.length <= 254 && EMAIL_RE.test(e);
}

function maskEmail_(email){
  const e = trim_(email);
  const at = e.indexOf('@');
  if(at <= 0) return '';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const safeLocal = local.length <= 2 ? local[0] + '*' : local[0] + '***' + local[local.length - 1];
  const dot = domain.lastIndexOf('.');
  const safeDomain = dot > 0 ? domain[0] + '***' + domain.slice(dot) : '***';
  return safeLocal + '@' + safeDomain;
}

function baseUrl_(){
  const configured = getEnv_('APP_BASE_URL', '');
  if(configured) return configured.replace(/\/+$/,'');
  try{
    const serviceUrl = ScriptApp.getService().getUrl();
    if(serviceUrl) return serviceUrl.replace(/\/+$/,'');
  }catch(_){}
  return '';
}

function newRatingToken_(){
  const seed = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Math.random()),
    String(new Date().getTime())
  ].join(':');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function saveUserEmail_(p){
  const who = normName_(p && p.person);
  const email = trim_(p && p.email).toLowerCase();
  if(!who) return { ok:false, error:'person required' };
  if(getPeople_().indexOf(who) < 0) return { ok:false, error:'unknown person' };
  if(email && !isValidEmail_(email)) return { ok:false, error:'bad email' };

  const sh = ss_().getSheetByName('Users');
  const lastRow = sh.getLastRow();
  const now = new Date().toISOString();
  if(lastRow >= 2){
    const rows = sh.getRange(2,1,lastRow-1,3).getValues();
    for(let r=0;r<rows.length;r++){
      if(normName_(rows[r][0]) === who){
        sh.getRange(r+2,1,1,3).setValues([[who,email,now]]);
        return { ok:true, emailSet: !!email };
      }
    }
  }
  sh.appendRow([who,email,now]);
  return { ok:true, emailSet: !!email };
}

function getUserEmailMap_(){
  const out = {};
  const sh = ss_().getSheetByName('Users');
  if(!sh || sh.getLastRow() < 2) return out;
  const rows = sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
  rows.forEach(row=>{
    const person = normName_(row[0]);
    const email = trim_(row[1]).toLowerCase();
    if(person && isValidEmail_(email)) out[person] = email;
  });
  return out;
}

function buildRatingEmail_(film, token){
  const base = baseUrl_();
  const links = [];
  for(let i=1;i<=10;i++){
    const href = base
      ? `${base}/rate/${encodeURIComponent(token)}?rating=${i}`
      : `/rate/${encodeURIComponent(token)}?rating=${i}`;
    links.push({ rating:i, href });
  }
  const safeFilm = escapeHtml_(film);
  const text = `Dags att betygsätta: ${film}\n\nKlicka på ett betyg mellan 1 och 10:\n\n` +
    links.map(x => `${x.rating}: ${x.href}`).join('\n') +
    '\n\nDu kan klicka igen om du vill ändra betyget senare.';
  const htmlLinks = links.map(x => {
    const bg = x.rating >= 8 ? '#22c55e' : (x.rating >= 5 ? '#f7c948' : '#ef4444');
    const color = x.rating >= 5 ? '#111827' : '#ffffff';
    return `<a href="${escapeHtml_(x.href)}" style="display:inline-block;width:44px;line-height:44px;margin:5px;border-radius:10px;background:${bg};color:${color};font-weight:800;font-size:18px;text-align:center;text-decoration:none">${x.rating}</a>`;
  }).join('');
  const html = `
    <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <div style="padding:22px 24px;background:#111827;color:#ffffff">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#f7c948;font-weight:700">Filmkväll</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2">Betygsätt filmen</h1>
        </div>
        <div style="padding:24px">
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280">Ni har tittat på</p>
          <div style="margin:0 0 22px;font-size:22px;font-weight:800;line-height:1.25">${safeFilm}</div>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.45">Välj ditt betyg. Länken sparar betyget direkt och du kan klicka igen om du vill ändra dig.</p>
          <div style="margin:18px 0 8px">${htmlLinks}</div>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.45;color:#6b7280">Om knapparna inte fungerar kan du kopiera en av länkarna från textversionen av mejlet.</p>
        </div>
      </div>
    </div>`;
  return { subject:`Betygsätt: ${film}`, text, html };
}

function deliverRatingEmail_(person, email, film, token){
  const msg = buildRatingEmail_(film, token);
  const provider = String(getEnv_('MAIL_PROVIDER', 'mailapp')).toLowerCase();
  const mode = String(getEnv_('EMAIL_MODE', 'send')).toLowerCase();
  const shouldSend = provider === 'mailapp' && mode === 'send';

  if(shouldSend){
    MailApp.sendEmail({
      to: email,
      subject: msg.subject,
      body: msg.text,
      htmlBody: msg.html,
      name: getEnv_('MAIL_FROM_NAME', 'Filmkväll')
    });
    return 'sent';
  }

  const sh = ss_().getSheetByName('DevEmails');
  sh.appendRow([new Date().toISOString(), 'development', maskEmail_(email), person, film, msg.subject, msg.text, msg.html]);
  return 'development';
}

function createRatingTokensAndSendEmails_(film, historyRow){
  const PEOPLE = getPeople_();
  const emails = getUserEmailMap_();
  const sh = ss_().getSheetByName('RatingTokens');
  const createdAt = new Date().toISOString();
  const date = today_();
  let sent = 0;
  let dev = 0;
  let skipped = 0;

  PEOPLE.forEach(person=>{
    const email = emails[person];
    if(!email){
      skipped++;
      return;
    }
    const token = newRatingToken_();
    sh.appendRow([token, historyRow, date, film, person, '', '', createdAt]);
    const status = deliverRatingEmail_(person, email, film, token);
    if(status === 'sent') sent++;
    else dev++;
  });

  return { sent, development: dev, skippedNoEmail: skipped };
}

function createRatingTokenAndSendEmail_(film, historyRow, person, email){
  const sh = ss_().getSheetByName('RatingTokens');
  const token = newRatingToken_();
  sh.appendRow([token, historyRow, today_(), film, person, '', '', new Date().toISOString()]);
  const status = deliverRatingEmail_(person, email, film, token);
  return {
    sent: status === 'sent' ? 1 : 0,
    development: status === 'sent' ? 0 : 1,
    skippedNoEmail: 0
  };
}

/** ===== Actions ===== */
function getCurrent_(){
  const PEOPLE = getPeople_();
  const active = getActiveNight_();
  let idx = Number(getConfig_('nextIndex') || '0');
  if(!isFinite(idx) || idx < 0) idx = 0;
  idx = idx % PEOPLE.length;

  const who = (active && PEOPLE.indexOf(active.who) >= 0) ? active.who : PEOPLE[idx];

  const suggestion = active ? active.film : ((getWishlist_({ person: who }) || {}).R1 || '');

  const scores = getScores_().scores || {};
  return {
    ok:true,
    next:who,
    suggestion,
    scores,
    active: !!active,
    activeBy: active ? active.by : '',
    activeAt: active ? active.at : ''
  };
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

function getActiveNight_(){
  const who = normName_(getConfig_('activeWho'));
  const film = trim_(getConfig_('activeFilm'));
  if(!who || !film) return null;
  return {
    who,
    film,
    by: normName_(getConfig_('activeBy')),
    at: trim_(getConfig_('activeAt'))
  };
}

function setActiveNight_(who, film, by){
  setConfig_('activeWho', who);
  setConfig_('activeFilm', film);
  setConfig_('activeBy', by || '');
  setConfig_('activeAt', new Date().toISOString());
}

function clearActiveNight_(){
  setConfig_('activeWho', '');
  setConfig_('activeFilm', '');
  setConfig_('activeBy', '');
  setConfig_('activeAt', '');
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

function rateByToken_(tokenRaw, ratingRaw){
  const token = trim_(tokenRaw);
  const rating = Number(ratingRaw);
  if(!token || !Number.isInteger(rating) || rating < 1 || rating > 10){
    return html_('Ogiltigt betyg', '<p class="msg">Ogiltig länk eller ogiltigt betyg.</p>');
  }

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)){
    return html_('Försök igen', '<p class="msg">Systemet är upptaget. Försök igen om en liten stund.</p>');
  }

  try{
    const shR = ss_().getSheetByName('RatingTokens');
    if(!shR || shR.getLastRow() < 2){
      return html_('Ogiltig token', '<p class="msg">Ogiltig eller utgången rating-token.</p>');
    }

    const lastCol = shR.getLastColumn();
    const headers = shR.getRange(1,1,1,lastCol).getValues()[0];
    const rows = shR.getRange(2,1,shR.getLastRow()-1,lastCol).getValues();
    const idx = {};
    headers.forEach((h,i)=> idx[String(h)] = i);

    for(let r=0;r<rows.length;r++){
      if(String(rows[r][idx.Token]) !== token) continue;

        const historyRow = Number(rows[r][idx.HistoryRow]);
        const film = trim_(rows[r][idx.Film]);
        const person = normName_(rows[r][idx.Person]);
        if(!historyRow || !film || !person){
          return html_('Ogiltig token', '<p class="msg">Ogiltig eller utgången rating-token.</p>');
        }

        const shH = ss_().getSheetByName('History');
        const headH = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0].map(normName_);
        const personCol = headH.indexOf(person) + 1;
        if(personCol <= 0 || historyRow < 2 || historyRow > shH.getLastRow()){
          return html_('Ogiltig token', '<p class="msg">Ogiltig eller utgången rating-token.</p>');
        }

        shH.getRange(historyRow, personCol).setValue(rating);
        shR.getRange(r+2, idx.Rating + 1).setValue(rating);
        shR.getRange(r+2, idx.RatedAt + 1).setValue(new Date().toISOString());

        return html_(
          'Betyg sparat',
          `<p class="msg">Tack! Ditt betyg ${rating} för filmen ${escapeHtml_(film)} är sparat.</p>`
        );
    }

    return html_('Ogiltig token', '<p class="msg">Ogiltig eller utgången rating-token.</p>');
  }finally{
    lock.releaseLock();
  }
}

function sendTestRatingEmails_(p){
  if(!envBool_('TEST_MOVIES_ENABLED', false)){
    return { ok:false, error:'test movies disabled' };
  }

  const film = trim_((p && p.film) || getEnv_('TEST_MOVIE_TITLE', 'Testfilm'));
  const who = normName_((p && p.who) || getPeople_()[0]);
  if(!film) return { ok:false, error:'film required' };
  if(getPeople_().indexOf(who) < 0) return { ok:false, error:'unknown person' };

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) return { ok:false, error:'lock timeout' };

  try{
    const shH = ss_().getSheetByName('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    const row = headers.map(h=>{
      if(h === 'Datum') return today_();
      if(h === 'Film') return film;
      if(h === 'Vem valde') return who;
      if(h === 'Kommentar') return 'TEST';
      return '';
    });
    shH.appendRow(row);
    const mail = createRatingTokensAndSendEmails_(film, shH.getLastRow());
    return { ok:true, film, mail };
  }finally{
    lock.releaseLock();
  }
}

function sendTestRatingEmail_(p){
  const who = normName_((p && p.who) || (p && p.person) || getPeople_()[0]);
  const email = trim_(p && p.email).toLowerCase();
  const film = trim_((p && p.film) || getEnv_('TEST_MOVIE_TITLE', 'Testfilm'));

  if(!who) return { ok:false, error:'person required' };
  if(getPeople_().indexOf(who) < 0) return { ok:false, error:'unknown person' };
  if(!email || !isValidEmail_(email)) return { ok:false, error:'bad email' };
  if(!film) return { ok:false, error:'film required' };

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) return { ok:false, error:'lock timeout' };

  try{
    saveUserEmail_({ person: who, email });

    const shH = ss_().getSheetByName('History');
    const headers = shH.getRange(1,1,1,shH.getLastColumn()).getValues()[0];
    const row = headers.map(h=>{
      if(h === 'Datum') return today_();
      if(h === 'Film') return film;
      if(h === 'Vem valde') return who;
      if(h === 'Kommentar') return 'TEST EMAIL';
      return '';
    });
    shH.appendRow(row);

    const mail = createRatingTokenAndSendEmail_(film, shH.getLastRow(), who, email);
    return { ok:true, film, person: who, mail };
  }finally{
    lock.releaseLock();
  }
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
    clearActiveNight_();
    return { ok:true, next: PEOPLE[idx] };
  }finally{
    lock.releaseLock();
  }
}

function startNight_(p){
  const PEOPLE = getPeople_();
  const film = trim_(p && p.film);
  const by = normName_(p && p.by);

  if(!film) return { ok:false, error:'film required' };

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(8000)) return { ok:false, error:'lock timeout' };

  try{
    const active = getActiveNight_();
    let idx = Number(getConfig_('nextIndex') || '0');
    if(!isFinite(idx) || idx < 0) idx = 0;
    idx = idx % PEOPLE.length;

    const owner = (active && PEOPLE.indexOf(active.who) >= 0) ? active.who : PEOPLE[idx];
    if(active && by !== owner){
      return { ok:false, error:'locked', owner, message:'only owner can change active movie' };
    }

    setActiveNight_(owner, film, by);
    setConfig_('nextIndex', String(PEOPLE.indexOf(owner)));
    return { ok:true, next:owner, suggestion:film, active:true, activeBy:by };
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
    const historyRow = shH.getLastRow();
    const mail = createRatingTokensAndSendEmails_(film, historyRow);

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
    clearActiveNight_();

    return { ok:true, nextPerson: PEOPLE[nextIdx], mail };
  }finally{
    lock.releaseLock();
  }
}
