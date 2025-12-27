// film-wishlist.js
// Wishlist module: autocomplete + poster + IMDb + streaming (Watchmode) + reorder + autosave

import { api } from './api.js';
import { getWho, on } from './store.js';
import { getMovieTokens } from './film-login.js';

customElements.define('film-wishlist', class FilmWishlist extends HTMLElement {
  constructor(){
    super();
    this.attachShadow({ mode:'open' });

    this._who = getWho?.() || 'Maria';
    this._tokens = getMovieTokens?.() || {};

    this._metaCache = new Map(); // key: normalized query -> meta
    this._wmCache = new Map();   // imdbID -> sources[]

    this._autosaveTimer = null;
    this._applying = false;

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}
        .card{background:var(--panel,#fff); border:1px solid var(--border,#dfe3ee); border-radius:16px; padding:16px; margin:14px 0; box-shadow:0 6px 20px rgba(0,0,0,.04)}
        h3{margin:0 0 6px; font-size:20px}
        .muted{color:var(--muted,#5b6475)}

        .head{display:flex; align-items:flex-start; gap:12px}
        .head .right{margin-left:auto; display:flex; gap:10px; align-items:center}
        .pill{display:inline-block; padding:6px 10px; border-radius:999px; font-size:13px; background:var(--pill-bg,#f1f3f8); border:1px solid var(--border,#dfe3ee); text-decoration:none; color:inherit; white-space:nowrap}

        button{background:var(--btn,#eef0f6); color:var(--btn-text,#111826); cursor:pointer;
          border:1px solid var(--border,#dfe3ee); padding:10px 14px; border-radius:999px; font-size:14px;}
        button.primary{background:var(--accent,#f6c247); color:#1b1f2a; border-color:#c8a73a}
        button:disabled{opacity:.55; cursor:not-allowed; filter:saturate(.6)}

        .list{display:flex; flex-direction:column; gap:12px; margin-top:12px}

        .row{display:flex; gap:10px; align-items:center}
        .rowline{display:flex; gap:10px; align-items:center; flex-wrap:wrap}
        .num{width:28px; color:var(--muted,#5b6475); font-size:14px; flex:0 0 auto}

        input{
          width:100%; padding:10px 12px; border-radius:12px;
          border:1px solid var(--border,#dfe3ee); background:var(--input,#fff); color:var(--text,#151823);
          outline:none;
        }

        .item{border:1px solid var(--border,#dfe3ee); border-radius:14px; padding:12px}
        .topline{display:flex; gap:10px; align-items:center}
        .topline .inputwrap{flex:1 1 auto; min-width:0; position:relative}
        .actions{display:flex; gap:8px; align-items:center}
        .actions button{padding:10px 14px}
        .actions .mini{width:44px; height:44px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:14px; font-size:18px; line-height:1}

        /* Autocomplete */
        .ac{position:absolute; left:0; right:0; top:100%; margin-top:6px; z-index:50;
          background:var(--panel,#fff); border:1px solid var(--border,#dfe3ee); border-radius:12px; overflow:hidden; display:none}
        .ac-item{padding:10px 12px; border-top:1px solid var(--border,#dfe3ee); cursor:pointer; font-size:14px}
        .ac-item:first-child{border-top:none}
        .ac-item:hover{filter:brightness(1.05)}
        .ac-muted{color:var(--muted,#5b6475); font-size:12px}

        /* Meta layout (like now): poster left, imdb mid, streaming right */
        .meta{margin-top:10px; display:grid; grid-template-columns:92px 1fr; gap:12px; align-items:start}
        .poster{
          width:92px; height:138px; object-fit:cover; border-radius:12px; border:1px solid var(--border,#dfe3ee);
          background:#fff;
        }
        .metaMain{display:grid; grid-template-columns:1fr 1.6fr; gap:12px; align-items:start}
        .imdb{min-width:0}
        .imdb a{color:inherit; text-decoration:underline}
        .imdb .title{font-weight:700}

        .streaming{justify-self:end; text-align:left; min-width:0; max-width:520px}
        .streaming strong{display:block; font-size:13px; color:var(--muted,#5b6475); margin-bottom:6px}
        .streams{display:flex; flex-wrap:wrap; gap:6px}
        /* show ~2 rows */
        .streams.collapsed{max-height:56px; overflow:hidden}
        .toggle{margin-top:6px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted,#5b6475); font-size:12px}

        .hint{color:var(--muted,#5b6475); font-size:13px}

        @media (max-width:640px){
          .meta{grid-template-columns:84px 1fr}
          .poster{width:84px; height:126px}
          .metaMain{grid-template-columns:1fr}
          .streaming{justify-self:start; max-width:none}
        }
      </style>

      <div class="card">
        <div class="head">
          <div>
            <h3>Önskelista</h3>
            <div class="muted">Användare: <span id="whoLabel"></span></div>
          </div>
          <div class="right">
            <button id="btnLoad">Hämta</button>
            <button id="btnSave" class="primary">Spara</button>
          </div>
        </div>

        <div class="list" id="list"></div>
      </div>
    `;

    this.$ = (sel)=>this.shadowRoot.querySelector(sel);
    this.$$ = (sel)=>Array.from(this.shadowRoot.querySelectorAll(sel));
  }

  connectedCallback(){
    this.$('#whoLabel').textContent = this._who;
    this.$('#btnLoad').addEventListener('click', ()=>this.load(true));
    this.$('#btnSave').addEventListener('click', ()=>this.save(true));

    // react to login/user changes
    if (typeof on === 'function'){
      this._unsubWho = on('who', (w)=>{
        this._who = w;
        this.$('#whoLabel').textContent = w;
        this.load(true);
      });
    }

    this.renderEmpty();
    this.load(true);
  }

  disconnectedCallback(){
    this._unsubWho?.();
  }

  renderEmpty(){
    const list = this.$('#list');
    list.innerHTML = '';
    for(let i=1;i<=5;i++) list.appendChild(this.renderItem(i));
    this.bindAll();
  }

  renderItem(i){
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.i = String(i);
    el.innerHTML = `
      <div class="topline">
        <div class="num">#${i}</div>
        <div class="inputwrap">
          <input id="w${i}" placeholder="Film (${i})" autocomplete="off" spellcheck="false" />
          <div class="ac" id="ac-w${i}"></div>
        </div>
        <div class="actions">
          <button class="btnSearch" data-i="${i}">Sök</button>
          <button class="mini" title="Flytta upp" aria-label="Flytta upp" data-move="up" data-i="${i}" ${i===1?'disabled':''}>▲</button>
          <button class="mini" title="Flytta ner" aria-label="Flytta ner" data-move="down" data-i="${i}" ${i===5?'disabled':''}>▼</button>
        </div>
      </div>

      <div class="meta" id="meta${i}" style="display:none"></div>
      <div class="hint" id="hint${i}"></div>
    `;
    return el;
  }

  bindAll(){
    // search buttons
    this.$$('.btnSearch').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const i = Number(btn.dataset.i);
        await this.lookupAndRender(i, {withStreaming:true});
      });
    });

    // move
    this.shadowRoot.addEventListener('click', (e)=>{
      const btn = e.target?.closest?.('[data-move][data-i]');
      if(!btn) return;
      const i = Number(btn.dataset.i);
      const dir = btn.dataset.move;
      if(dir === 'up' && i>1) this.swap(i, i-1);
      if(dir === 'down' && i<5) this.swap(i, i+1);
    });

    // inputs: autosave + enter lookup
    for(let i=1;i<=5;i++){
      const input = this.$(`#w${i}`);
      input.addEventListener('input', ()=>this.scheduleAutosave('skriver'));
      input.addEventListener('blur', ()=>this.commitAutosave('klar'));
      input.addEventListener('keydown', async (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault();
          await this.lookupAndRender(i, {withStreaming:true});
        }
      });

      this.bindAutocomplete(`w${i}`);
    }

    // close autocomplete when clicking outside
    this.shadowRoot.addEventListener('click', (e)=>{
      if(e.target?.closest?.('.inputwrap')) return;
      for(let i=1;i<=5;i++) this.hideAc(`w${i}`);
    });
  }

  // ===== Data load/save =====
  async load(useCache){
    try{
      const who = this._who;
      const j = await api('getWishlist', { person: who });
      if(!j?.ok) throw new Error(j?.error || 'getWishlist');

      this._applying = true;
      for(let i=1;i<=5;i++){
        const val = (j[`R${i}`] || '').trim();
        this.$(`#w${i}`).value = val;
        this.$(`#hint${i}`).textContent = '';
        this.$(`#meta${i}`).style.display = 'none';
        this.$(`#meta${i}`).innerHTML = '';
      }
      this._applying = false;

      // render metas in background
      for(let i=1;i<=5;i++){
        const q = (this.$(`#w${i}`).value || '').trim();
        if(q) this.lookupAndRender(i, {withStreaming:false});
      }
    }catch(err){
      console.error(err);
      // Keep UI, show hints
      for(let i=1;i<=5;i++) this.$(`#hint${i}`).textContent = (i===1 ? 'Kunde inte hämta listan.' : '');
    }
  }

  async save(flash){
    const who = this._who;
    const body = { person: who };
    for(let i=1;i<=5;i++) body[`R${i}`] = (this.$(`#w${i}`).value || '').trim();

    const btn = this.$('#btnSave');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Sparar…';

    try{
      const j = await api('saveWishlist', body);
      if(!j?.ok) throw new Error(j?.error || 'saveWishlist');
      btn.textContent = 'Sparad';
      setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, 650);
    }catch(err){
      console.error(err);
      btn.textContent = 'Fel';
      setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, 900);
    }
  }

  scheduleAutosave(reason){
    if(this._applying) return;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(()=>this.commitAutosave(reason), 1500);
  }

  commitAutosave(reason){
    if(this._applying) return;
    // don't autosave completely empty list
    const any = [1,2,3,4,5].some(i => (this.$(`#w${i}`).value||'').trim().length);
    if(!any) return;
    this.save(false);
  }

  swap(a,b){
    const A = this.$(`#w${a}`);
    const B = this.$(`#w${b}`);
    if(!A || !B) return;

    this._applying = true;
    const tmp = A.value;
    A.value = B.value;
    B.value = tmp;
    this._applying = false;

    // re-render metas for both
    this.lookupAndRender(a, {withStreaming:false});
    this.lookupAndRender(b, {withStreaming:false});

    this.scheduleAutosave('ordning');
  }

  // ===== Lookup / Render meta =====
  normKey(s){
    return String(s||'')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,' ');
  }

  imdbUrl(meta){
    return meta?.imdbID ? `https://www.imdb.com/title/${meta.imdbID}/` : '';
  }

  async smartLookup(query){
    const q = (query||'').trim();
    if(!q) return null;

    const key = this.normKey(q);
    if(this._metaCache.has(key)) return this._metaCache.get(key);

    const { tmdb, omdb } = this._tokens || {};

    // If query includes imdb tt-id, go straight to OMDb
    if(/\btt\d{7,}\b/i.test(q) || /imdb\.com\/title\/tt\d+/i.test(q)){
      const om = await this.omdbLookup(q, omdb);
      if(om) { this._metaCache.set(key, om); return om; }
    }

    // TMDb first (better search), then OMDb for details if imdbID exists
    const tm = await this.tmdbLookup(q, tmdb);
    if(tm){
      if(tm.imdbID){ this._metaCache.set(key, tm); return tm; }
      const tryOm = await this.omdbLookup(`${tm.Title} (${tm.Year||''})`, omdb);
      const best = tryOm || tm;
      this._metaCache.set(key, best);
      return best;
    }

    const om = await this.omdbLookup(q, omdb);
    this._metaCache.set(key, om);
    return om;
  }

  async omdbLookup(q, key){
    if(!key) return null;
    let query = (q||'').trim();

    // pull out year from (YYYY)
    let year = '';
    const m = query.match(/\((\d{4})\)\s*$/);
    if(m){ year = m[1]; query = query.replace(/\s*\(\d{4}\)\s*$/,'').trim(); }

    // imdb id direct
    const tt = query.match(/tt\d{7,}/i) || query.match(/imdb\.com\/title\/(tt\d+)/i);
    if(tt){
      const id = (tt[1] || tt[0]).replace(/^.*(tt\d+).*$/,'$1');
      const r = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(id)}&plot=short`, {cache:'no-store'}).catch(()=>null);
      const j = r ? await r.json() : null;
      return (j && j.Response !== 'False') ? j : null;
    }

    // title
    const u = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(query)}&type=movie&plot=short${year?`&y=${encodeURIComponent(year)}`:''}`;
    const r = await fetch(u, {cache:'no-store'}).catch(()=>null);
    const j = r ? await r.json() : null;
    if(j && j.Response !== 'False') return j;

    // fallback: search
    const rs = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(query)}&type=movie`, {cache:'no-store'}).catch(()=>null);
    const js = rs ? await rs.json() : null;
    if(js && js.Response !== 'False' && Array.isArray(js.Search) && js.Search.length){
      // pick first
      return await this.omdbLookup(js.Search[0].Title, key);
    }
    return null;
  }

  async tmdbLookup(query, key){
    if(!key) return null;
    const q = (query||'').trim();
    if(!q) return null;

    // search sv
    const sr = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(key)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`,
      {cache:'no-store'}
    ).catch(()=>null);
    if(!sr || !sr.ok) return null;
    const sj = await sr.json();
    const hit = Array.isArray(sj?.results) && sj.results.length ? sj.results[0] : null;
    if(!hit) return null;

    // external ids for imdb
    let imdbID = '';
    try{
      const er = await fetch(
        `https://api.themoviedb.org/3/movie/${hit.id}/external_ids?api_key=${encodeURIComponent(key)}`,
        {cache:'no-store'}
      );
      if(er.ok){
        const ej = await er.json();
        imdbID = ej?.imdb_id || '';
      }
    }catch(_){ }

    const year = (hit.release_date || '').slice(0,4) || '';
    const poster = hit.poster_path ? `https://image.tmdb.org/t/p/w185${hit.poster_path}` : 'N/A';

    return {
      Title: hit.title || hit.original_title || '',
      Year: year,
      Poster: poster,
      imdbID,
      imdbRating: '-'
    };
  }

  async getStreaming(imdbID){
    const { watchmode } = this._tokens || {};
    if(!watchmode || !imdbID) return null;

    if(this._wmCache.has(imdbID)) return this._wmCache.get(imdbID);

    const titleId = await this.wmTitleIdFromImdb(imdbID, watchmode);
    if(!titleId){ this._wmCache.set(imdbID, null); return null; }

    const r = await fetch(`https://api.watchmode.com/v1/title/${titleId}/sources/?apiKey=${encodeURIComponent(watchmode)}`, {cache:'no-store'}).catch(()=>null);
    if(!r || !r.ok){ this._wmCache.set(imdbID, null); return null; }
    const data = await r.json();
    if(!Array.isArray(data)){ this._wmCache.set(imdbID, null); return null; }

    const seen = new Set();
    const normName = (s)=>String(s||'').replace(/\s*\(with Ads\)$/i,'').replace(/\s+HD$/,'').trim();

    const filtered = data
      .filter(s=>s.type==='sub' && s.name)
      .map(s=>({
        service: normName(s.name),
        region: s.region || '',
        quality: (s.format==='4K' || s.format==='HD') ? s.format : '',
        link: s.web_url || ''
      }))
      .filter(s=>{
        const k = `${s.service}|${s.region}|${s.quality}`;
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a,b)=>(a.service+a.region+a.quality).localeCompare(b.service+b.region+b.quality));

    const out = filtered.length ? filtered : null;
    this._wmCache.set(imdbID, out);
    return out;
  }

  async wmTitleIdFromImdb(imdbID, apiKey){
    try{
      const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(apiKey)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
      const r1 = await fetch(u1, {cache:'no-store'}).catch(()=>null);
      if(r1 && r1.ok){
        const j = await r1.json();
        if(j?.title_id) return j.title_id;
      }
      const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(apiKey)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
      const r2 = await fetch(u2, {cache:'no-store'}).catch(()=>null);
      if(r2 && r2.ok){
        const j = await r2.json();
        const hit = Array.isArray(j?.title_results) ? j.title_results.find(t=>String(t.imdb_id)===String(imdbID)) : null;
        if(hit?.id) return hit.id;
      }
    }catch(_){ }
    return null;
  }

  esc(s){
    return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  async lookupAndRender(i, {withStreaming=true}={}){
    const input = this.$(`#w${i}`);
    const q = (input?.value || '').trim();
    const metaEl = this.$(`#meta${i}`);
    const hintEl = this.$(`#hint${i}`);

    if(!q){
      metaEl.style.display = 'none';
      metaEl.innerHTML = '';
      hintEl.textContent = '';
      return;
    }

    hintEl.textContent = 'Söker…';

    const meta = await this.smartLookup(q);
    if(!meta){
      metaEl.style.display = 'none';
      metaEl.innerHTML = '';
      hintEl.textContent = `Hittade inget för: ${q}`;
      return;
    }

    hintEl.textContent = '';

    // streaming can be heavy; fetch only if asked and imdbID exists
    let streams = null;
    if(withStreaming && meta.imdbID){
      // show hint while loading
      streams = await this.getStreaming(meta.imdbID);
    }

    const poster = (meta.Poster && meta.Poster !== 'N/A')
      ? meta.Poster
      : '';

    const title = this.esc(meta.Title || q);
    const year  = this.esc(meta.Year || '');
    const rating = this.esc(meta.imdbRating || '-');
    const imdb = this.imdbUrl(meta);

    const streamPills = (streams && streams.length)
      ? streams.map(s=>{
          const label = `${s.service}${s.quality?` ${s.quality}`:''}${s.region?` · ${s.region}`:''}`;
          const href = s.link ? `href="${this.esc(s.link)}" target="_blank" rel="noopener"` : '';
          return `<a class="pill" ${href}>${this.esc(label)} (ingår)</a>`;
        }).join('')
      : '';

    metaEl.innerHTML = `
      ${poster ? `<img class="poster" src="${this.esc(poster)}" alt="poster" loading="lazy" decoding="async" />` : `<div class="poster" aria-hidden="true"></div>`}
      <div class="metaMain">
        <div class="imdb">
          <div class="title">${title}${year?` (${year})`:''}</div>
          <div>IMDb ${rating}${imdb ? ` — <a href="${this.esc(imdb)}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}</div>
        </div>

        <div class="streaming" ${withStreaming ? '' : 'style="display:none"'}>
          <strong>Tillgängligt i abonnemang (globalt):</strong>
          ${streams === null ? `<div class="muted">(klicka Sök för att hämta)</div>` : ''}
          ${streamPills ? `<div class="streams collapsed">${streamPills}</div>
            <button type="button" class="toggle" style="display:none">…</button>`
          : (withStreaming ? `<div class="muted">Inget abonnemang hittades just nu.</div>` : '')}
        </div>
      </div>
    `;

    metaEl.style.display = 'grid';

    // collapse toggle (only if we have pills)
    const streamsEl = metaEl.querySelector('.streams');
    const toggle = metaEl.querySelector('.toggle');
    if(streamsEl && toggle){
      requestAnimationFrame(()=>{
        const needs = streamsEl.scrollHeight > streamsEl.clientHeight + 2;
        toggle.style.display = needs ? 'inline-block' : 'none';
        toggle.textContent = '…';
      });
      toggle.addEventListener('click', ()=>{
        const collapsed = streamsEl.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '…' : 'visa färre';
      });
    }
  }

  // ===== Autocomplete (TMDb) =====
  debounce(fn, ms=380){
    let t;
    return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  }

  async tmdbSuggest(query, limit=8){
    const { tmdb } = this._tokens || {};
    if(!tmdb) return [];
    const q = (query||'').trim();
    if(q.length < 3) return [];

    const r = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdb)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`,
      {cache:'no-store'}
    ).catch(()=>null);

    if(!r || !r.ok) return [];
    const j = await r.json();
    const res = Array.isArray(j?.results) ? j.results : [];
    return res.slice(0, limit).map(it=>({
      title: it.title || it.original_title || '',
      year: (it.release_date||'').slice(0,4) || ''
    }));
  }

  hideAc(id){
    const box = this.$(`#ac-${id}`);
    if(!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  showAc(id, items, onPick){
    const box = this.$(`#ac-${id}`);
    if(!box) return;
    if(!items.length){ this.hideAc(id); return; }

    box.innerHTML = items.map((x, idx)=>`
      <div class="ac-item" data-i="${idx}">
        <div><strong>${this.esc(x.title)}</strong> <span class="ac-muted">${this.esc(x.year)}</span></div>
      </div>
    `).join('');

    box.style.display = 'block';

    box.querySelectorAll('.ac-item').forEach(el=>{
      const handler = (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const i = Number(el.getAttribute('data-i'));
        onPick(items[i]);
        this.hideAc(id);
      };
      // iOS friendly
      el.addEventListener('pointerdown', handler, {passive:false});
      el.addEventListener('touchstart', handler, {passive:false});
      el.addEventListener('click', handler);
    });
  }

  bindAutocomplete(id){
    const input = this.$(`#${id}`);
    const box = this.$(`#ac-${id}`);
    if(!input || !box) return;

    let composing = false;
    input.addEventListener('compositionstart', ()=>{ composing = true; });
    input.addEventListener('compositionend', ()=>{ composing = false; });

    const search = this.debounce(async ()=>{
      if(composing) return;
      if(this.shadowRoot.activeElement !== input) return;

      const q = (input.value||'').trim();
      if(q.length < 3){ this.hideAc(id); return; }

      const hits = await this.tmdbSuggest(q, 8);
      if(this.shadowRoot.activeElement !== input) return;

      this.showAc(id, hits, (pick)=>{
        input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
      });
    }, 420);

    input.addEventListener('input', search);
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') this.hideAc(id); });
    input.addEventListener('blur', ()=>{ setTimeout(()=>this.hideAc(id), 140); });
  }
});
