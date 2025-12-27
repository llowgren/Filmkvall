// film-wishlist.js
// Önskelista (1–5)
// Mål: samma känsla som “now”-kortet
// - Autocomplete (lugnt, ej ryckigt)
// - Thumbnail vänster
// - IMDb-länk strax till höger om thumbnail
// - Streaming-länkar på samma rad som thumbnail, högerställda (2 rader + expand)
// - Upp/ner för turordning
// - Autospar (lugnt) + manuell Spara-knapp

import { store } from './store.js';
import { smartLookup, renderOmdbInfo } from './api.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];

function debounce(fn, ms=400){
  let t;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), ms);
  };
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

async function tmdbSearchMovies(query, limit=8){
  const tokens = getMovieTokens?.() || {};
  const TMDB_KEY = tokens.tmdb;
  if(!TMDB_KEY) return [];
  const q = String(query||'').trim();
  if(q.length < 3) return [];

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(TMDB_KEY)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(()=>null);
  if(!r || !r.ok) return [];
  const j = await r.json().catch(()=>null);
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map(it=>({
    title: it.title || it.original_title || '',
    year: (it.release_date||'').slice(0,4) || ''
  }));
}

function makeAc(){
  const el = document.createElement('div');
  el.className = 'ac-list';
  el.style.display = 'none';
  return el;
}

function hideAc(box){
  if(!box) return;
  box.style.display = 'none';
  box.innerHTML = '';
}

function showAc(box, items, onPick){
  if(!box) return;
  if(!items?.length){ hideAc(box); return; }

  box.innerHTML = items.map((x,i)=>`
    <div class="ac-item" data-i="${i}">
      <div><strong>${escapeHtml(x.title)}</strong> <span class="ac-muted">${escapeHtml(x.year)}</span></div>
    </div>
  `).join('');

  box.style.display = 'block';

  box.querySelectorAll('.ac-item').forEach(node=>{
    const handler = (ev)=>{
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      const idx = Number(node.getAttribute('data-i'));
      onPick(items[idx]);
      hideAc(box);
    };
    // iOS: pointer/touch + click
    node.addEventListener('pointerdown', handler, { passive:false });
    node.addEventListener('touchstart', handler, { passive:false });
    node.addEventListener('click', handler);
  });
}

customElements.define('film-wishlist', class extends HTMLElement {
  #autoTimer = null;
  #isApplying = false;
  #lastSig = '';

  connectedCallback(){
    this.innerHTML = `
      <style>
        /* Kortets topp */
        .wl-head{display:flex; align-items:center; gap:10px}
        .wl-head .right{margin-left:auto}

        /* Rader */
        .wl-row{margin:14px 0}
        .wl-inputRow{display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:center}
        .wl-inputRow input{width:100%}

        /* Flytta upp/ner */
        .wl-move{display:flex; gap:8px; justify-content:flex-end}
        .wl-move button{width:42px; height:42px; padding:0; border-radius:12px; font-size:18px; line-height:1;
          display:flex; align-items:center; justify-content:center; touch-action:manipulation;}

        /* Meta: EXACT som i now-layouten: thumbnail vänster + IMDb bredvid, streaming höger */
        .wl-meta{display:flex; gap:12px; align-items:flex-start; margin-top:10px}
        .wl-meta .omdb-info{margin:0; display:flex; gap:12px; align-items:flex-start; width:100%}
        .wl-meta .omdb-left{display:flex; gap:12px; align-items:flex-start}
        .wl-meta img{width:96px; height:auto; border-radius:10px; border:1px solid var(--border);}

        /* Streamingblock till höger på samma rad */
        .wl-meta .streaming-wrap{margin-left:auto; max-width:62%; text-align:right}
        .wl-meta .streaming-row{display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end}

        /* 2 rader synliga */
        .wl-meta .streaming-row.collapsed{max-height:48px; overflow:hidden}

        /* Små skärmar: låt streaming gå ner under om det blir trångt */
        @media (max-width:640px){
          .wl-meta{flex-direction:column}
          .wl-meta .streaming-wrap{margin-left:0; max-width:100%; text-align:left}
          .wl-meta .streaming-row{justify-content:flex-start}
        }

        /* Autocomplete */
        .ac-wrap{ position:relative; }
        .ac-list{
          position:absolute; left:0; right:0; top:100%;
          z-index:50;
          background:var(--panel);
          border:1px solid var(--border);
          border-radius:10px;
          margin-top:6px;
          overflow:hidden;
        }
        .ac-item{ padding:10px 12px; cursor:pointer; border-top:1px solid var(--border); font-size:14px; }
        .ac-item:first-child{ border-top:none; }
        .ac-item:hover{ filter:brightness(1.08); }
        .ac-muted{ color:var(--muted); font-size:12px; }
      </style>

      <div class="card">
        <div class="wl-head">
          <div>
            <h3 style="margin:0">Önskelista</h3>
            <div class="muted">Användare: <strong id="wlWho">–</strong></div>
          </div>
          <span class="right"></span>
          <button id="wlLoad" class="ghost">Hämta</button>
          <button id="wlSave" class="primary">Spara</button>
        </div>

        <div id="wlList"></div>

        <div class="muted" style="font-size:12px; margin-top:8px">Autospar sker i bakgrunden efter en kort paus.</div>
      </div>
    `;

    this.listEl = this.querySelector('#wlList');
    this.whoEl = this.querySelector('#wlWho');

    this.querySelector('#wlLoad').onclick = ()=>this.load();
    this.querySelector('#wlSave').onclick = ()=>this.save({reason:'manual'});

    // Uppdatera rubrik när användaren byts i login
    const rerender = ()=>this.render();
    if (typeof store?.subscribe === 'function') store.subscribe(rerender);
    this.render();

    // Bygg 5 tomma rader direkt (så layout alltid finns)
    this.draw(['','','','','']);

    // Ladda direkt (känns som gamla index)
    this.load().catch(()=>{});

    // Stäng autocomplete när man klickar utanför
    this.addEventListener('click', (e)=>{
      if (e.target?.closest?.('.ac-wrap')) return;
      this.querySelectorAll('.ac-list').forEach(box=>hideAc(box));
    });
  }

  render(){
    const who = store?.get?.('who') || store?.getWho?.() || '';
    this.whoEl.textContent = who || '–';
  }

  signature(who){
    const vals = [...this.listEl.querySelectorAll('[data-i] input')].map(x=>String(x.value||'').trim());
    return [who, ...vals].join('␟');
  }

  scheduleAutoSave(reason=''){
    clearTimeout(this.#autoTimer);
    this.#autoTimer = setTimeout(()=>this.save({reason}), 1400);
  }

  async load(){
    const who = store?.get?.('who') || store?.getWho?.() || '';
    if(!who) return;

    const wl = await store.api('getWishlist', { person: who });
    if(!wl?.ok) return;

    this.#isApplying = true;
    this.draw([wl.R1, wl.R2, wl.R3, wl.R4, wl.R5]);
    this.#isApplying = false;

    this.#lastSig = this.signature(who);

    // Rendera meta för befintliga värden (parallellt, men lugnt)
    const tasks = [...this.listEl.querySelectorAll('[data-i]')].map(async row=>{
      const input = row.querySelector('input');
      if((input?.value || '').trim()) await this.lookupAndRender(row, {withStreaming:true});
      else row.querySelector('.wl-meta').innerHTML = '';
    });
    await Promise.allSettled(tasks);
  }

  async save({reason=''} = {}){
    const who = store?.get?.('who') || store?.getWho?.() || '';
    if(!who) return;

    if(this.#isApplying) return;

    const sig = this.signature(who);
    if(sig === this.#lastSig && reason !== 'manual') return; // inget ändrat

    const rows = [...this.listEl.querySelectorAll('[data-i]')].map(r=>r.querySelector('input')?.value || '');

    // försiktighet: spara bara om det finns något (eller om användaren tryckte Spara)
    const hasAny = rows.some(x=>String(x||'').trim().length);
    if(!hasAny && reason !== 'manual') return;

    this.#lastSig = sig;

    const btn = this.querySelector('#wlSave');
    const prevText = btn?.textContent;
    if(btn){
      btn.disabled = true;
      btn.textContent = (reason === 'manual') ? 'Sparar…' : 'Autospar…';
    }

    const res = await store.api('saveWishlist', {
      person: who,
      R1: rows[0] || '',
      R2: rows[1] || '',
      R3: rows[2] || '',
      R4: rows[3] || '',
      R5: rows[4] || ''
    }).catch(()=>null);

    if(btn){
      btn.disabled = false;
      btn.textContent = prevText || 'Spara';
    }

    // tyst misslyckande (status visas i system-blocket om ni vill)
    if(!res?.ok && reason === 'manual'){
      // liten visuell hint utan att störa
      btn?.classList?.add('flash');
      setTimeout(()=>btn?.classList?.remove('flash'), 500);
    }
  }

  draw(values){
    this.listEl.innerHTML = '';
    values.forEach((v, idx)=>this.addRow(idx + 1, v || ''));
    this.updateMoveButtons();
  }

  updateMoveButtons(){
    const rows = [...this.listEl.querySelectorAll('[data-i]')];
    rows.forEach((row, idx)=>{
      const up = row.querySelector('[data-move="up"]');
      const down = row.querySelector('[data-move="down"]');
      if(up) up.disabled = (idx === 0);
      if(down) down.disabled = (idx === rows.length - 1);
    });
  }

  swap(i, j){
    const rows = [...this.listEl.querySelectorAll('[data-i]')];
    const a = rows[i-1];
    const b = rows[j-1];
    if(!a || !b) return;

    this.#isApplying = true;

    const aIn = a.querySelector('input');
    const bIn = b.querySelector('input');
    const tmp = aIn.value;
    aIn.value = bIn.value;
    bIn.value = tmp;

    // Byt meta-innehåll också så det inte “hoppar” visuellt
    const aMeta = a.querySelector('.wl-meta');
    const bMeta = b.querySelector('.wl-meta');
    const tmpHtml = aMeta.innerHTML;
    aMeta.innerHTML = bMeta.innerHTML;
    bMeta.innerHTML = tmpHtml;

    this.#isApplying = false;

    this.updateMoveButtons();
    this.scheduleAutoSave('ordning');
  }

  bindAutocomplete(input, box){
    let composing = false;
    input.addEventListener('compositionstart', ()=>{ composing = true; });
    input.addEventListener('compositionend', ()=>{ composing = false; });

    const doSearch = debounce(async ()=>{
      if(composing) return;
      if(document.activeElement !== input) return;
      const q = (input.value || '').trim();
      if(q.length < 3){ hideAc(box); return; }

      const hits = await tmdbSearchMovies(q, 8);
      if(document.activeElement !== input) return;

      showAc(box, hits, (pick)=>{
        input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
        input.dispatchEvent(new Event('input', { bubbles:true }));
        input.dispatchEvent(new Event('change', { bubbles:true }));
      });
    }, 420);

    input.addEventListener('input', doSearch);
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') hideAc(box); });
    input.addEventListener('blur', ()=> setTimeout(()=>hideAc(box), 150));
  }

  async lookupAndRender(row, {withStreaming=true} = {}){
    const input = row.querySelector('input');
    const meta = row.querySelector('.wl-meta');
    const q = (input?.value || '').trim();
    if(!q){ meta.innerHTML = ''; return; }

    const data = await smartLookup(q);

    // renderOmdbInfo ska kunna ta element-container i er modulversion.
    // Vi skickar layout=side så streaming hamnar “på samma rad” (högerställd).
    // CSS ovan säkerställer att det ser ut som i now.
    renderOmdbInfo(meta, data, q, {
      withStreaming,
      layout: 'side',
      maxStreamingRows: 2
    });
  }

  addRow(i, value){
    const row = document.createElement('div');
    row.className = 'wl-row';
    row.dataset.i = String(i);

    row.innerHTML = `
      <div class="wl-inputRow">
        <div class="ac-wrap">
          <input value="${escapeHtml(value)}" placeholder="#${i}" autocomplete="off" spellcheck="false" autocapitalize="off" />
        </div>
        <button class="ghost" data-action="lookup">Sök</button>
        <div class="wl-move" aria-label="Flytta önskan">
          <button type="button" class="ghost" data-move="up" aria-label="Flytta upp">▲</button>
          <button type="button" class="ghost" data-move="down" aria-label="Flytta ner">▼</button>
        </div>
      </div>
      <div class="wl-meta"></div>
    `;

    const input = row.querySelector('input');
    const acBox = makeAc();
    row.querySelector('.ac-wrap')?.appendChild(acBox);

    this.bindAutocomplete(input, acBox);

    // lookup
    row.querySelector('[data-action="lookup"]').onclick = async ()=>{
      const btn = row.querySelector('[data-action="lookup"]');
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Söker…';
      try{
        await this.lookupAndRender(row, {withStreaming:true});
      }finally{
        btn.disabled = false;
        btn.textContent = prev;
      }
    };

    // enter = lookup
    input.addEventListener('keydown', async (e)=>{
      if(e.key !== 'Enter') return;
      e.preventDefault();
      await this.lookupAndRender(row, {withStreaming:true});
      this.scheduleAutoSave('klar');
    });

    // autosave lugnt
    input.addEventListener('input', ()=>{
      if(this.#isApplying) return;
      this.scheduleAutoSave('skriver');
    });
    input.addEventListener('change', async ()=>{
      if(this.#isApplying) return;
      await this.lookupAndRender(row, {withStreaming:true});
      this.scheduleAutoSave('klar');
    });
    input.addEventListener('blur', ()=>{
      if(this.#isApplying) return;
      this.scheduleAutoSave('klar');
    });

    // move
    row.querySelector('[data-move="up"]').onclick = ()=>{
      const idx = Number(row.dataset.i);
      if(idx > 1) this.swap(idx, idx-1);
    };
    row.querySelector('[data-move="down"]').onclick = ()=>{
      const idx = Number(row.dataset.i);
      if(idx < 5) this.swap(idx, idx+1);
    };

    this.listEl.appendChild(row);
  }
});
