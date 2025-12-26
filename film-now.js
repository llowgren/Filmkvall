// film-now.js
import { api } from './api.js';
import { getWho, on as onStore } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function normLite(s){
  return String(s||'').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
function debounce(fn, ms=300){
  let t;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
function imdbUrlFrom(j){ return j?.imdbID ? `https://www.imdb.com/title/${j.imdbID}/` : ''; }

function getTokens(){
  const t = getMovieTokens?.() || {};
  return {
    tmdb: t.tmdb || '',
    omdb: t.omdb || '',
    watchmode: t.watchmode || ''
  };
}

/* ============ External lookups (TMDb -> OMDb -> Watchmode) ============ */

async function tmdbSearchMovies(query, limit=8){
  const { tmdb } = getTokens();
  if(!tmdb || !query) return [];
  const url =
    `https://api.themoviedb.org/3/search/movie` +
    `?api_key=${encodeURIComponent(tmdb)}` +
    `&language=sv-SE&include_adult=false` +
    `&query=${encodeURIComponent(query)}`;

  const r = await fetch(url, { cache:'no-store' }).catch(()=>null);
  if(!r || !r.ok) return [];
  const j = await r.json().catch(()=>null);
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map(it => ({
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0,4) || '',
    id: it.id
  }));
}

async function tmdbExternalIds(movieId){
  const { tmdb } = getTokens();
  if(!tmdb || !movieId) return null;
  const url = `https://api.themoviedb.org/3/movie/${movieId}/external_ids?api_key=${encodeURIComponent(tmdb)}`;
  const r = await fetch(url, { cache:'no-store' }).catch(()=>null);
  if(!r || !r.ok) return null;
  return r.json().catch(()=>null);
}

async function tmdbLookup(query){
  const hit = (await tmdbSearchMovies(query, 8))[0];
  if(!hit) return null;

  const ids = await tmdbExternalIds(hit.id);
  const imdbID = ids?.imdb_id || '';

  // TMDb poster (smått räcker)
  // (vi tar OMDb poster om vi hittar den, annars TMDb)
  const poster = ''; // vi fyller via OMDb om vi kan

  return {
    Title: hit.title || '',
    Year: hit.year || '',
    Poster: poster,
    imdbID,
    imdbRating: '-'
  };
}

async function omdbLookup(query){
  const { omdb } = getTokens();
  if(!omdb || !query) return null;

  let q = query.trim();
  let year = '';
  const mYear = q.match(/\((\d{4})\)\s*$/);
  if(mYear){ year = mYear[1]; q = q.replace(/\s*\(\d{4}\)\s*$/,'').trim(); }

  // imdb id?
  const tt = q.match(/\btt\d{7,}\b/i) || q.match(/imdb\.com\/title\/(tt\d+)/i);
  if(tt){
    const id = (tt[1] || tt[0]).toLowerCase();
    const r = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(id)}&plot=short`, {cache:'no-store'}).catch(()=>null);
    const j = r ? await r.json().catch(()=>null) : null;
    if(j && j.Response !== 'False') return j;
    return null;
  }

  // title exact
  {
    const r = await fetch(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(q)}${year?`&y=${encodeURIComponent(year)}`:''}&type=movie&plot=short`,
      {cache:'no-store'}
    ).catch(()=>null);
    const j = r ? await r.json().catch(()=>null) : null;
    if(j && j.Response !== 'False') return j;
  }

  // search fallback
  {
    const r = await fetch(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&s=${encodeURIComponent(q)}&type=movie`,
      {cache:'no-store'}
    ).catch(()=>null);
    const j = r ? await r.json().catch(()=>null) : null;
    if(j && j.Response !== 'False' && Array.isArray(j.Search) && j.Search.length){
      // ta första
      return omdbLookup(`${j.Search[0].Title} (${j.Search[0].Year})`);
    }
  }

  return null;
}

async function smartLookup(query){
  const q = (query || '').trim();
  if(!q) return null;

  // 1) TMDb (bra sök)
  const tm = await tmdbLookup(q);
  if(tm){
    // Om vi har imdbID: försök hämta OMDb för rating/poster
    if(tm.imdbID){
      const om = await omdbLookup(tm.imdbID);
      return om || tm;
    }
    // annars: försök OMDb via title/year
    const om2 = await omdbLookup(`${tm.Title}${tm.Year?` (${tm.Year})`:''}`);
    return om2 || tm;
  }

  // 2) OMDb
  return omdbLookup(q);
}

/* Watchmode */
const wmIdCache = new Map();
async function wmTitleIdFromImdb(imdbID){
  const { watchmode } = getTokens();
  if(!watchmode || !imdbID) return null;
  if(wmIdCache.has(imdbID)) return wmIdCache.get(imdbID);

  try{
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    const r1 = await fetch(u1, {cache:'no-store'}).catch(()=>null);
    if(r1 && r1.ok){
      const j1 = await r1.json().catch(()=>null);
      if(j1?.title_id){ wmIdCache.set(imdbID, j1.title_id); return j1.title_id; }
    }

    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(watchmode)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    const r2 = await fetch(u2, {cache:'no-store'}).catch(()=>null);
    if(r2 && r2.ok){
      const j2 = await r2.json().catch(()=>null);
      const hit = Array.isArray(j2?.title_results) ? j2.title_results.find(t => String(t.imdb_id) === String(imdbID)) : null;
      if(hit?.id){ wmIdCache.set(imdbID, hit.id); return hit.id; }
    }
  }catch(_){}
  return null;
}

async function getStreamingInfo(imdbID){
  const { watchmode } = getTokens();
  if(!watchmode || !imdbID) return null;

  // enkel cache i localStorage (7 dagar)
  const key = `wm_sources_v1_${imdbID}`;
  try{
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if(cached?.savedAt && (Date.now()-cached.savedAt) < 7*24*3600_000){
      return cached.data || null;
    }
  }catch(_){}

  const wmId = await wmTitleIdFromImdb(imdbID);
  if(!wmId) return null;

  const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${encodeURIComponent(watchmode)}`;
  const r = await fetch(url, {cache:'no-store'}).catch(()=>null);
  if(!r || !r.ok) return null;

  const data = await r.json().catch(()=>null);
  if(!Array.isArray(data)) return null;

  const seen = new Set();
  const normalizeName = s => String(s||'').replace(/\s*\(with Ads\)$/i,'').trim();

  const filtered = data
    .filter(s => s.type === 'sub' && s.name)
    .map(s => ({
      service: normalizeName(s.name),
      region: s.region || '',
      quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
      link: s.web_url || ''
    }))
    .filter(s => {
      const k = `${s.service}|${s.region}|${s.quality}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a,b)=> (a.service+a.region+a.quality).localeCompare(b.service+b.region+b.quality));

  const out = filtered.length ? filtered : null;
  try{ localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: out })); }catch(_){}
  return out;
}

function pillsHtml(sources){
  if(!sources?.length) return `<div class="muted" style="margin-top:6px;font-size:12px">Inget abonnemang hittades just nu.</div>`;
  const pills = sources.map(s=>{
    const label = `${s.service}${s.quality?` ${s.quality}`:''}${s.region?` · ${s.region}`:''}`;
    const href = s.link ? `href="${esc(s.link)}" target="_blank" rel="noopener"` : '';
    return `<a ${href} class="pill" style="text-decoration:none">${esc(label)} (ingår)</a>`;
  }).join(' ');
  return `
    <div class="streaming-wrap">
      <strong>Tillgängligt i abonnemang (globalt):</strong>
      <div class="streaming-row collapsed">${pills}</div>
      <button type="button" class="streaming-toggle">…</button>
    </div>
  `;
}

/* ============ Web component ============ */

class FilmNow extends HTMLElement {
  constructor(){
    super();
    this._whoUnsub = null;
    this._loading = false;
  }

  connectedCallback(){
    this.render();
    this.bind();
    this.load();
  }

  disconnectedCallback(){
    try{ this._whoUnsub?.(); }catch(_){}
  }

  render(){
    this.innerHTML = `
      <div class="card" id="nowCard">
        <div class="row" style="align-items:center">
          <div>
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted" style="font-size:13px">Inloggad: <strong id="loggedIn">–</strong></div>
          </div>
          <span class="right"></span>
          <button id="btnRefresh" class="ghost">Uppdatera</button>
          <button id="btnSkip" class="ghost">Hoppa över</button>
        </div>

        <div class="row" style="margin-top:12px">
          <div class="col">
            <label>Nästa i tur</label>
            <input id="nextName" type="text" readonly>
          </div>

          <div class="col">
            <label>Film (förslag)</label>
            <div class="lookup-wrap ac-wrap">
              <input id="film" class="lookup-input" type="text" autocomplete="off" spellcheck="false">
              <button id="btnLookup" class="lookup-btn">Sök</button>
              <div class="ac-list" id="ac-film" style="display:none"></div>
            </div>
            <div id="filmInfo" class="omdb-info"></div>
          </div>
        </div>

        <div style="margin-top:10px">
          <label>Poäng</label>
          <div id="scoresRow" style="display:flex; gap:8px; overflow:auto; padding-bottom:2px"></div>
        </div>

        <div class="row" style="margin-top:10px; align-items:flex-end; gap:8px">
          <div class="col">
            <label>Kommentar</label>
            <input id="comment" placeholder="valfritt">
          </div>
          <div class="col" style="align-self:end; flex:0 0 auto">
            <button id="btnSaveNight" class="primary">Spara kväll</button>
          </div>
        </div>
      </div>
    `;
  }

  bind(){
    const loggedIn = this.querySelector('#loggedIn');
    const applyWho = () => { loggedIn.textContent = getWho?.() || '–'; };
    applyWho();
    this._whoUnsub = onStore?.('who', applyWho) || null;

    // scores UI
    const scoresRow = this.querySelector('#scoresRow');
    scoresRow.innerHTML = PEOPLE.map(p=>`
      <div class="score-col" style="min-width:100px;flex:1 1 0">
        <label style="margin-bottom:4px">${esc(p)}</label>
        <select id="s-${esc(p)}" class="score-select">
          <option value="">–</option>
          ${Array.from({length:10}, (_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}
        </select>
      </div>
    `).join('');

    // buttons
    this.querySelector('#btnRefresh').addEventListener('click', ()=>this.load(true));
    this.querySelector('#btnSkip').addEventListener('click', ()=>this.skip());
    this.querySelector('#btnSaveNight').addEventListener('click', ()=>this.saveNight());

    // lookup button
    this.querySelector('#btnLookup').addEventListener('click', ()=>this.lookupFilm());

    // save score on change
    PEOPLE.forEach(p=>{
      this.querySelector(`#s-${CSS.escape(p)}`).addEventListener('change', (e)=>{
        const val = (e.target.value || '').trim();
        this.saveScore(p, val);
      });
    });

    // autocomplete
    this.bindAutocomplete();
    // enter triggers lookup
    this.querySelector('#film').addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); this.lookupFilm(); }
      if(e.key === 'Escape') this.hideAc();
    });

    // stäng autocomplete när man klickar utanför
    document.addEventListener('click', (e)=>{
      if(e.target?.closest?.('.ac-wrap')) return;
      this.hideAc();
    });
  }

  setBusy(b){
    this._loading = b;
    this.querySelector('#btnRefresh').disabled = b;
    this.querySelector('#btnSkip').disabled = b;
    this.querySelector('#btnSaveNight').disabled = b;
    this.querySelector('#btnLookup').disabled = b;
  }

  async load(force=false){
    if(this._loading) return;
    this.setBusy(true);
    try{
      const cur = await api('getCurrent', {});
      if(!cur?.ok) throw new Error(cur?.error || 'getCurrent');

      this.querySelector('#nextName').value = cur.next || '';

      const filmEl = this.querySelector('#film');
      const serverSuggestion = (cur.suggestion || '').trim();
      filmEl.value = serverSuggestion;
      // om server inte har förslag: gör fältet skrivbart (vi vill kunna skriva film)
      filmEl.readOnly = false;

      // scores
      if(cur.scores){
        PEOPLE.forEach(p=>{
          const el = this.querySelector(`#s-${CSS.escape(p)}`);
          if(el) el.value = (cur.scores[p] ?? '').toString();
        });
      }

      // auto-preview direkt (som gamla)
      await this.lookupFilm(true);

    }catch(err){
      console.error(err);
    }finally{
      this.setBusy(false);
    }
  }

  async skip(){
    if(this._loading) return;
    this.setBusy(true);
    try{
      const j = await api('skipNext', {});
      if(!j?.ok) throw new Error(j?.error || 'skipNext');
      await this.load(true);
    }catch(err){
      console.error(err);
    }finally{
      this.setBusy(false);
    }
  }

  async saveScore(person, val){
    try{
      // backend tar JSON-string
      await api('saveScores', { scores: JSON.stringify({ [person]: val }) });
    }catch(err){
      console.error(err);
    }
  }

  async saveNight(){
    if(this._loading) return;
    const who = (this.querySelector('#nextName').value || '').trim();
    const film = (this.querySelector('#film').value || '').trim();
    const comment = (this.querySelector('#comment').value || '').trim();

    if(!who || !film) return;

    this.setBusy(true);
    try{
      const j = await api('saveNight', { who, film, comment });
      if(!j?.ok) throw new Error(j?.error || 'saveNight');
      this.querySelector('#comment').value = '';
      await this.load(true);
    }catch(err){
      console.error(err);
    }finally{
      this.setBusy(false);
    }
  }

  async lookupFilm(quiet=false){
    const q = (this.querySelector('#film').value || '').trim();
    const info = this.querySelector('#filmInfo');
    if(!q){ info.innerHTML = ''; return; }

    if(!quiet) info.innerHTML = `<div class="muted">Söker…</div>`;

    const data = await smartLookup(q);
    if(!data){
      info.innerHTML = `<div class="muted">Hittade inget för: ${esc(q)}</div>`;
      return;
    }

    const title  = esc(data.Title || '');
    const year   = esc(data.Year || '');
    const rating = esc(data.imdbRating || '-');
    const link   = imdbUrlFrom(data);
    const poster = (data.Poster && data.Poster !== 'N/A')
      ? `<img src="${esc(data.Poster)}" alt="poster" loading="lazy" decoding="async">`
      : '';

    // streaming (lazy: klick “…” om du vill, men vi hämtar direkt här för att matcha gamla)
    let streaming = '';
    if(data.imdbID){
      const sources = await getStreamingInfo(data.imdbID);
      streaming = `
        <div class="streaming-wrap" style="margin-top:8px">
          ${pillsHtml(sources)}
        </div>
      `;
    }

    info.innerHTML = `
      ${poster}
      <div>
        <strong>${title}</strong>${year?` (${year})`:''}<br>
        IMDb ${rating}${link?` — <a href="${esc(link)}" target="_blank" rel="noopener">Öppna på IMDb</a>`:''}
        ${streaming}
      </div>
    `;

    // toggle för streaming-row (om den finns)
    const row = info.querySelector('.streaming-row');
    const btn = info.querySelector('.streaming-toggle');
    if(row && btn){
      const updateBtn = ()=>{
        const needs = row.scrollHeight > row.clientHeight + 2;
        btn.style.display = needs ? 'inline-block' : 'none';
        btn.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
      };
      updateBtn();
      btn.addEventListener('click', ()=>{
        row.classList.toggle('collapsed');
        updateBtn();
      });
    }
  }

  /* ============ Autocomplete (TMDb) ============ */

  hideAc(){
    const box = this.querySelector('#ac-film');
    if(!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  showAc(items){
    const box = this.querySelector('#ac-film');
    if(!box) return;

    if(!items.length){ this.hideAc(); return; }

    box.innerHTML = items.map((x,i)=>`
      <div class="ac-item" data-i="${i}">
        <div><strong>${esc(x.title)}</strong> <span class="ac-muted">${esc(x.year)}</span></div>
      </div>
    `).join('');
    box.style.display = 'block';

    box.querySelectorAll('.ac-item').forEach(el=>{
      const pick = (ev)=>{
        ev.preventDefault?.();
        ev.stopPropagation?.();
        const i = Number(el.getAttribute('data-i'));
        const it = items[i];
        const filmEl = this.querySelector('#film');
        filmEl.value = it.year ? `${it.title} (${it.year})` : it.title;
        this.hideAc();
        // auto-preview direkt
        this.lookupFilm(true);
      };
      el.addEventListener('pointerdown', pick, {passive:false});
      el.addEventListener('touchstart', pick, {passive:false});
      el.addEventListener('click', pick);
    });
  }

  bindAutocomplete(){
    const filmEl = this.querySelector('#film');
    const doSearch = debounce(async ()=>{
      // sök bara om fältet är fokus och minst 3 tecken
      if(document.activeElement !== filmEl) return;
      const q = (filmEl.value || '').trim();
      if(q.length < 3){ this.hideAc(); return; }

      const hits = await tmdbSearchMovies(q, 8);
      // fokus kan ha flyttats under nätet
      if(document.activeElement !== filmEl) return;

      // enkel ranking: exakt/startsWith först
      const qn = normLite(q);
      const ranked = hits
        .map(h=>{
          const tn = normLite(h.title);
          let score = 0;
          if(tn === qn) score = 100;
          else if(tn.startsWith(qn)) score = 80;
          else if(tn.includes(qn)) score = 60;
          return { score, h };
        })
        .sort((a,b)=>b.score-a.score)
        .map(x=>x.h);

      this.showAc(ranked);
    }, 380);

    filmEl.addEventListener('input', doSearch);
    filmEl.addEventListener('blur', ()=>setTimeout(()=>this.hideAc(), 150));
  }
}

customElements.define('film-now', FilmNow);