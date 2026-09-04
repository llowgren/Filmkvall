import { api } from './api.js';
import { getMovieTokens, getUsers } from './film-login.js';

const PEOPLE = getUsers();
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';
const cache = new Map();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val = (row, key) => row?.[key] ?? '';

function reaction(raw){
  const s = String(raw ?? '').trim().toLowerCase();
  if(s === 'star') return 1.25;
  if(s === 'up') return .65;
  if(s === 'neutral') return 0;
  if(s === 'down') return -.65;
  if(s === 'noll') return -1.25;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? (n - 5) / 5 : null;
}

function newId(){
  try{ if(typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); }catch{}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function titleOf(r){ return String(val(r,'Film')).trim(); }
function pickerOf(r){ return String(val(r,'Vem valde')).trim(); }
function poster(path){ return path ? `${IMG}${path}` : ''; }
function yearOf(m){ return String(m.release_date || m.first_air_date || '').slice(0,4); }
function typeOf(m){ return m.media_type || (m.first_air_date ? 'tv' : 'movie'); }
function movieTitle(m){ return m.title || m.name || m.original_title || m.original_name || ''; }
function normalize(s){ return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }

async function tmdb(path, params={}){
  const key = `${path}?${JSON.stringify(params)}`;
  if(cache.has(key)) return cache.get(key);
  const token = getMovieTokens().tmdb;
  const qs = new URLSearchParams({api_key:token,language:'sv-SE',include_adult:'false',...params});
  const promise = fetch(`${TMDB}${path}?${qs}`,{cache:'force-cache'}).then(r=>r.ok?r.json():null).catch(()=>null);
  cache.set(key,promise);
  return promise;
}

function rankPeople(history){
  const total = history.length || 1;
  const maxPicks = Math.max(0,...PEOPLE.map(p=>history.filter(r=>pickerOf(r)===p).length));
  return PEOPLE.map(person=>{
    const picks = history.filter(r=>pickerOf(r)===person);
    let last = -1, participation = 0;
    history.forEach((r,i)=>{ if(pickerOf(r)===person && last<0) last=i; if(String(val(r,person)).trim()!=='') participation++; });
    const otherScores = picks.flatMap(r=>PEOPLE.filter(p=>p!==person).map(p=>reaction(val(r,p))).filter(v=>v!==null));
    const quality = otherScores.length ? otherScores.reduce((a,b)=>a+b,0)/otherScores.length : 0;
    const deficit = maxPicks - picks.length;
    const wait = last < 0 ? history.length + 1 : last;
    const activeRate = participation / total;
    const score = deficit*60 + Math.min(wait,12)*3 + activeRate*18 + quality*8;
    let reason = deficit ? `${deficit} val färre än den som valt flest` : (last<0?'Har ännu inte valt':`${last} kvällar sedan senaste valet`);
    if(activeRate < .35) reason += ' · låg aktivitet';
    else if(quality > .25) reason += ' · uppskattade val';
    return {person,picks:picks.length,participation,quality,score,reason};
  }).sort((a,b)=>b.score-a.score || a.picks-b.picks);
}

function likedSeeds(history, person, limit=5){
  return history.filter(r=>reaction(val(r,person)) > .25).sort((a,b)=>(reaction(val(b,person))||0)-(reaction(val(a,person))||0)).slice(0,limit).map(titleOf).filter(Boolean);
}

async function findExact(title){
  const j = await tmdb('/search/multi',{query:title,page:'1'});
  const wanted=normalize(title);
  return (j?.results||[]).filter(x=>['movie','tv'].includes(x.media_type)).sort((a,b)=>{
    const ae=normalize(movieTitle(a))===wanted?2:0, be=normalize(movieTitle(b))===wanted?2:0;
    return (be+(b.popularity||0)/1000)-(ae+(a.popularity||0)/1000);
  })[0]||null;
}

async function recommendations(history, person){
  const seen = new Set(history.map(r=>normalize(titleOf(r))));
  const ownSeeds = likedSeeds(history,person,5);
  const familySeeds = PEOPLE.filter(p=>p!==person).flatMap(p=>likedSeeds(history,p,1));
  const seeds = [...new Set([...ownSeeds,...familySeeds])].slice(0,9);
  if(!seeds.length){
    const j=await tmdb('/trending/movie/week');
    return (j?.results||[]).slice(0,6).map(x=>({...x,why:'Populär just nu',fit:0}));
  }
  const found = await Promise.all(seeds.map(async(seed)=>({seed,m:await findExact(seed)})));
  const batches = await Promise.all(found.filter(x=>x.m).map(async x=>{
    const t=typeOf(x.m), j=await tmdb(`/${t}/${x.m.id}/recommendations`,{page:'1'});
    return (j?.results||[]).slice(0,12).map(m=>({...m,media_type:t,_seed:x.seed,_own:ownSeeds.includes(x.seed)}));
  }));
  const map=new Map();
  batches.flat().forEach(m=>{
    const k=`${typeOf(m)}:${m.id}`; if(seen.has(normalize(movieTitle(m)))) return;
    const c=map.get(k)||{...m,hits:0,ownHits:0,seeds:[]}; c.hits++; c.ownHits+=m._own?1:0; c.seeds.push(m._seed); map.set(k,c);
  });
  return [...map.values()].map(m=>({...m,fit:m.ownHits*4+m.hits*2+(m.vote_average||0),why:m.ownHits?`Liknar ${m.seeds[0]}`:`Kan passa flera i familjen`})).sort((a,b)=>b.fit-a.fit).slice(0,6);
}

class FilmApp extends HTMLElement{
  constructor(){super();this.history=[];this.active=null;this.picker='';this.selected=null;this.ratings={};this.searchTimer=null;this.saving=false;this.syncing=false;this.viewMode='dashboard';}
  connectedCallback(){this.shell();this.restoreLocal();this.dashboard();this.load();this.syncQueue();window.addEventListener('online',()=>this.syncQueue());}
  restoreLocal(){try{this.history=JSON.parse(localStorage.getItem('filmkvall_history_cache')||'[]');this.active=JSON.parse(localStorage.getItem('filmkvall_active_meta')||'null');}catch{this.history=[];this.active=null;}}
  queue(){try{return JSON.parse(localStorage.getItem('filmkvall_sync_queue')||'[]');}catch{return[];}}
  saveQueue(q){localStorage.setItem('filmkvall_sync_queue',JSON.stringify(q));this.syncBadge();}
  enqueue(job){const q=this.queue();q.push({id:newId(),...job});this.saveQueue(q);queueMicrotask(()=>this.syncQueue());}
  upsertFinish(job){const q=this.queue();const i=q.findIndex(x=>x.type==='finish'&&x.nightId===job.nightId);const saved={id:i>=0?q[i].id:newId(),rev:Date.now(),...job};if(i>=0)q[i]=saved;else q.push(saved);this.saveQueue(q);setTimeout(()=>this.syncQueue(),50);}
  syncBadge(){const n=this.queue().length;const e=this.querySelector('#sync');if(e)e.textContent=this.syncing?'Synkar…':n?`${n} väntar på synkning`:'Synkad';}
  shell(){this.innerHTML=`<main class="app"><header class="topbar"><img class="logo" src="Logo.PNG" alt=""><div><h1>Filmkväll</h1><div class="sub">Välj smart. Rösta snabbt. Bygg statistiken.</div></div><div class="spacer"></div><span id="sync" class="syncBadge">Synkad</span><button class="iconBtn" data-home>Hem</button></header><div id="view" class="heroPanel"></div><div id="status" class="status" role="status"></div></main>`;this.querySelector('[data-home]').onclick=()=>{if(this.viewMode==='ratings')this.closeRatings();else this.dashboard();};}
  status(msg='',error=false){const e=this.querySelector('#status');e.textContent=msg;e.className=`status${error?' error':''}`;}
  async load(){try{const [h,c]=await Promise.all([api('getHistory',{limit:10000}),api('getCurrent')]);if(!h?.ok)throw Error(h?.error||'Historiken kunde inte hämtas');const pending=this.queue().filter(j=>j.type==='finish').map(j=>j.row);const remote=h.rows||[];const syncIds=new Set(remote.map(r=>String(r.SyncId||'')));this.history=[...pending.filter(r=>!syncIds.has(r._nightId)),...remote];localStorage.setItem('filmkvall_history_cache',JSON.stringify(this.history.slice(0,500)));if(!this.active&&c?.active)this.active={who:c.next,film:c.suggestion,nightId:newId()};if(this.viewMode==='dashboard')this.dashboard();this.syncBadge();}catch{this.syncBadge();}}

  async syncQueue(){if(this.syncing||!navigator.onLine)return;if(!this.queue().length){this.syncBadge();return;}this.syncing=true;this.syncBadge();try{while(this.queue().length){const job=this.queue()[0];if(job.type==='start'){let cur=await api('getCurrent');for(let i=0;i<PEOPLE.length&&cur?.next!==job.who;i++){await api('skipNext');cur=await api('getCurrent');}const res=await api('startNight',{film:job.film,by:job.who});if(!res?.ok)throw Error(res?.error||'Kunde inte synka filmvalet');this.saveQueue(this.queue().filter(x=>x.id!==job.id));}else if(job.type==='finish'){const sentRev=job.rev;const res=await api('finishNight',{clientId:job.nightId,who:job.who,film:job.film,ratings:JSON.stringify(job.ratings||{}),mediaType:job.mediaType||'movie',year:job.year||'',comment:job.comment||''});if(!res?.ok)throw Error(res?.error==='unknown action'?'Säker databassynkning väntar på backenduppdateringen':res?.error||'Kunde inte synka kvällen');this.saveQueue(this.queue().filter(x=>x.id!==job.id||x.rev!==sentRev));}else this.saveQueue(this.queue().filter(x=>x.id!==job.id));}this.status('Allt är synkat.');}catch(e){this.status(String(e.message||e).includes('backenduppdateringen')?'Sparat på iPad · mejlfri databassynkning väntar.':'Sparat på iPad · synkar automatiskt senare.');}finally{this.syncing=false;this.syncBadge();}}
  dashboard(){this.viewMode='dashboard';const v=this.querySelector('#view');if(this.active){v.innerHTML=`<div class="activeCard"><div class="posterPh activePoster"></div><div><div class="activeTitle">${esc(this.active.film)}</div><div class="activeMeta">Vald av ${esc(this.active.who)} · kvällens pågående val</div></div><button class="primary" data-rate>Sätt betyg</button></div>`;v.querySelector('[data-rate]').onclick=()=>this.rateView();return;}
    const rows=rankPeople(this.history);v.innerHTML=`<h2 class="sectionTitle">Vem ska välja?</h2><p class="lead">Rättvisa väger tyngst. Aktivitet och uppskattade val ger en mindre bonus.</p><div class="people">${rows.map((r,i)=>`<button class="person" data-person="${esc(r.person)}"><span class="rank">${i+1}</span><div class="personName">${esc(r.person)}</div><div class="personReason">${esc(r.reason)}</div><div class="personScore">${r.picks} tidigare val · ${r.participation} röster</div></button>`).join('')}</div>`;v.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>this.choose(b.dataset.person));}
  async choose(person){this.viewMode='choose';this.picker=person;const v=this.querySelector('#view');v.innerHTML=`<div class="pickerHead"><button class="backBtn" data-back>‹ Tillbaka</button><h2>${esc(person)} väljer</h2></div><div class="searchWrap"><input class="search" type="search" placeholder="Sök film, serie eller dokumentär…" autocapitalize="sentences"><span class="searchIcon">⌕</span></div><div id="searchResults"></div><h3>Förslag för ${esc(person)}</h3><div id="recs" class="movieGrid"><div class="empty">Tar fram förslag…</div></div>`;v.querySelector('[data-back]').onclick=()=>this.dashboard();const input=v.querySelector('.search');input.oninput=()=>{clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.search(input.value),260)};try{const recs=await recommendations(this.history,person);if(this.viewMode==='choose')this.renderMovies(recs,v.querySelector('#recs'));}catch(e){this.status('Kunde inte hämta förslag. Sökningen fungerar fortfarande.',true);}}
  renderMovies(items,root){root.innerHTML=items.length?items.map((m,i)=>`<button class="movie" data-i="${i}">${poster(m.poster_path)?`<img src="${poster(m.poster_path)}" alt="" loading="lazy">`:'<span class="posterPh"></span>'}<div class="movieBody"><div class="movieTitle">${esc(movieTitle(m))}</div><div class="movieWhy">${esc(m.why||`${yearOf(m)} · ${typeOf(m)==='tv'?'Serie':'Film'}`)}</div>${m.vote_average?`<span class="tag">TMDb ${Number(m.vote_average).toFixed(1)}</span>`:''}</div></button>`).join(''):'<div class="empty">Inga förslag ännu – sök efter det ni vill se.</div>';root.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>this.details(items[Number(b.dataset.i)]));}
  async search(q){const root=this.querySelector('#searchResults');if(q.trim().length<2){root.innerHTML='';return;}const j=await tmdb('/search/multi',{query:q.trim(),page:'1'});const items=(j?.results||[]).filter(x=>['movie','tv'].includes(x.media_type)).slice(0,8);root.className='searchResults';root.innerHTML=items.map((m,i)=>`<button class="searchHit" data-i="${i}">${poster(m.poster_path)?`<img src="${poster(m.poster_path)}" alt="">`:'<span class="posterPh"></span>'}<span><strong>${esc(movieTitle(m))}</strong><span class="small">${esc(yearOf(m))} · ${typeOf(m)==='tv'?'Serie':'Film'}</span></span></button>`).join('');root.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>this.details(items[Number(b.dataset.i)]));}
  async details(base){const type=typeOf(base);const data=await tmdb(`/${type}/${base.id}`,{append_to_response:'external_ids'});this.selected={...base,...data,media_type:type};const v=this.querySelector('#view');v.innerHTML=`<div class="pickerHead"><button class="backBtn" data-back>‹ Till förslagen</button></div><div class="detail">${poster(this.selected.poster_path)?`<img src="${poster(this.selected.poster_path)}" alt="">`:'<span class="posterPh"></span>'}<div><h2>${esc(movieTitle(this.selected))}</h2><div class="activeMeta">${esc(yearOf(this.selected))} · ${type==='tv'?'Serie':'Film'}${this.selected.runtime?` · ${this.selected.runtime} min`:''}</div><p class="detailText">${esc(this.selected.overview||'Ingen beskrivning tillgänglig.')}</p><div id="streams" class="streaming"><span class="small">Söker var den går att se globalt…</span></div><div class="detailActions"><button class="primary" data-start>Det här blir ${esc(this.picker)}s val</button></div></div></div>`;v.querySelector('[data-back]').onclick=()=>this.choose(this.picker);v.querySelector('[data-start]').onclick=()=>this.start();this.streaming(this.selected);}
  async streaming(m){const imdb=m.external_ids?.imdb_id;const root=this.querySelector('#streams');if(!root)return;if(!imdb){root.innerHTML='<span class="small">Ingen tillgänglighet hittades.</span>';return;}try{const key=getMovieTokens().watchmode;const f=await fetch(`https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(key)}&source=imdb&external_id=${encodeURIComponent(imdb)}`).then(r=>r.json());if(!f?.title_id)throw Error();const sources=await fetch(`https://api.watchmode.com/v1/title/${f.title_id}/sources/?apiKey=${encodeURIComponent(key)}`).then(r=>r.json());const unique=new Map();(Array.isArray(sources)?sources:[]).filter(s=>s.name&&['sub','free'].includes(s.type)).forEach(s=>unique.set(`${s.name}|${s.region}`,s));root.innerHTML=unique.size?[...unique.values()].map(s=>`<a class="stream" href="${esc(s.web_url||'#')}" target="_blank" rel="noopener">${esc(s.name)} · ${esc(s.region||'')}</a>`).join(''):'<span class="small">Inget abonnemang hittades just nu.</span>';}catch{root.innerHTML='<span class="small">Tillgänglighet kunde inte hämtas.</span>';}}
  start(){if(this.saving)return;this.saving=true;const m=this.selected;this.active={nightId:newId(),who:this.picker,film:movieTitle(m),mediaType:typeOf(m),externalId:String(m.id),poster:poster(m.poster_path),runtime:m.runtime||'',year:yearOf(m)};localStorage.setItem('filmkvall_active_meta',JSON.stringify(this.active));this.enqueue({type:'start',who:this.picker,film:this.active.film});this.dashboard();this.status('Sparat på iPad · synkas i bakgrunden.');this.saving=false;}
  draftKey(){return `filmkvall_ratings_${this.active?.nightId||normalize(`${this.active?.who}-${this.active?.film}`)}`;}
  rateView(){this.viewMode='ratings';try{this.active={...this.active,...JSON.parse(localStorage.getItem('filmkvall_active_meta')||'{}')}}catch{}try{this.ratings=JSON.parse(localStorage.getItem(this.draftKey())||'{}')}catch{this.ratings={}}const v=this.querySelector('#view');v.innerHTML=`<div class="pickerHead"><button class="backBtn" data-back>‹ Klar</button><h2>Betyg: ${esc(this.active.film)}</h2></div><p class="lead">Varje tryck sparas direkt. Tom rad betyder att personen inte deltog.</p><div class="ratings">${PEOPLE.map(p=>`<div class="ratingRow"><div class="ratingName">${esc(p)}</div><button class="rate star" data-p="${esc(p)}" data-r="star">⭐</button><button class="rate up" data-p="${esc(p)}" data-r="up">👍</button><button class="rate neutral" data-p="${esc(p)}" data-r="neutral">😐</button><button class="rate down" data-p="${esc(p)}" data-r="down">👎</button><button class="rate noll" data-p="${esc(p)}" data-r="noll">NÖLL</button></div>`).join('')}</div><div class="autosaved">Rösterna sparas automatiskt</div>`;v.querySelector('[data-back]').onclick=()=>this.closeRatings();v.querySelectorAll('.rate').forEach(b=>{b.classList.toggle('selected',this.ratings[b.dataset.p]===b.dataset.r);b.onclick=()=>{const p=b.dataset.p,r=b.dataset.r;if(this.ratings[p]===r)delete this.ratings[p];else this.ratings[p]=r;v.querySelectorAll(`[data-p="${p}"]`).forEach(x=>x.classList.toggle('selected',this.ratings[p]===x.dataset.r));this.saveRatings();};});}
  saveRatings(){const a=this.active;if(!a)return;localStorage.setItem(this.draftKey(),JSON.stringify(this.ratings));let row=this.history.find(r=>r._nightId===a.nightId);if(!row){row={'Datum':new Date().toISOString().slice(0,10),'Film':a.film,'Vem valde':a.who,_nightId:a.nightId};this.history.unshift(row);}PEOPLE.forEach(p=>row[p]=this.ratings[p]||'');localStorage.setItem('filmkvall_history_cache',JSON.stringify(this.history.slice(0,500)));this.upsertFinish({type:'finish',nightId:a.nightId,who:a.who,film:a.film,ratings:{...this.ratings},mediaType:a.mediaType||'movie',year:a.year||'',comment:`${a.mediaType==='tv'?'Serie':'Film'}${a.year?` · ${a.year}`:''}`,row:{...row}});this.status('Rösten är sparad på iPad.');}
  closeRatings(){if(this.active){localStorage.removeItem(this.draftKey());localStorage.removeItem('filmkvall_active_meta');}this.active=null;this.dashboard();this.status('Klart · databasen synkas i bakgrunden.');}
}

customElements.define('film-app',FilmApp);
