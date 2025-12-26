// film-now.js
import { api } from './api.js';
import { getUsers } from './film-login.js';

const PEOPLE = (typeof getUsers === 'function' ? getUsers() : ['Hannah','Maria','Tuva','Alva','Lars']);

customElements.define('film-now', class extends HTMLElement {
  connectedCallback() {
    this.renderShell();
    this.bind();
    this.load();
  }

  renderShell(){
    this.innerHTML = `
      <section class="card">
        <div class="row" style="justify-content:space-between; align-items:flex-end; flex-wrap:wrap">
          <div style="flex:1 1 240px">
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted" style="margin-top:4px">Nästa i tur: <strong id="nowNext">–</strong></div>
          </div>
          <div style="flex:0 0 auto; display:flex; gap:8px; align-items:center">
            <button id="nowReload" class="ghost">Uppdatera</button>
            <button id="nowSkip" class="ghost" title="Hoppa över nästa i tur">Hoppa över</button>
          </div>
        </div>

        <div class="row" style="margin-top:14px; align-items:flex-end">
          <div class="col" style="min-width:220px">
            <label>Film (förslag)</label>
            <input id="nowFilm" type="text" placeholder="Film…" />
          </div>
          <div class="col" style="min-width:220px">
            <label>Kommentar</label>
            <input id="nowComment" type="text" placeholder="valfritt" />
          </div>
          <div class="col" style="flex:0 0 auto">
            <button id="nowSaveNight" class="primary">Spara kväll</button>
          </div>
        </div>

        <div style="margin-top:14px">
          <label>Poäng</label>
          <div id="nowScores" class="row" style="align-items:flex-end; overflow:auto; padding-bottom:2px"></div>
          <div class="muted" id="nowScoreStatus" style="font-size:13px; margin-top:6px"></div>
        </div>
      </section>
    `;
  }

  bind(){
    this.querySelector('#nowReload')?.addEventListener('click', ()=>this.load());

    this.querySelector('#nowSkip')?.addEventListener('click', async ()=>{
      this.setMsg('Hoppar över…');
      try{
        const j = await api('skipNext');
        if(!j?.ok) throw new Error(j?.error || 'skipNext');
        await this.load();
        this.setMsg('OK – hoppade över.');
      }catch(e){
        this.setMsg('Fel – kunde inte hoppa över.');
      }
    });

    this.querySelector('#nowSaveNight')?.addEventListener('click', async ()=>{
      const who = (this._current?.next || '').trim();
      const film = (this.querySelector('#nowFilm')?.value || '').trim();
      const comment = (this.querySelector('#nowComment')?.value || '').trim();

      if(!who || !film){
        this.setMsg('Fel – saknar nästa i tur eller film.');
        return;
      }

      this.setMsg('Sparar kväll…');
      try{
        const j = await api('saveNight', { who, film, comment });
        if(!j?.ok) throw new Error(j?.error || 'saveNight');
        this.querySelector('#nowComment').value = '';
        await this.load();
        this.setMsg('OK – kväll sparad.');
      }catch(e){
        this.setMsg('Fel – kunde inte spara kväll.');
      }
    });
  }

  setMsg(s){
    const el = this.querySelector('#nowScoreStatus');
    if(el) el.textContent = s || '';
  }

  async load(){
    this.setMsg('Laddar…');
    try{
      const j = await api('getCurrent');
      this._current = j;

      if(!j?.ok) throw new Error(j?.error || 'getCurrent');

      // Next + suggestion
      this.querySelector('#nowNext').textContent = j.next || '–';
      const filmEl = this.querySelector('#nowFilm');
      if (filmEl) filmEl.value = j.suggestion || '';

      // Scores UI
      const box = this.querySelector('#nowScores');
      box.innerHTML = PEOPLE.map(p=>`
        <div style="min-width:110px; flex:1 1 0">
          <label style="margin-bottom:6px">${escapeHtml(p)}</label>
          <select data-score="${escapeAttr(p)}">
            <option value="">–</option>
            ${Array.from({length:10}, (_,i)=>String(i+1)).map(v=>`<option value="${v}">${v}</option>`).join('')}
          </select>
        </div>
      `).join('');

      // set current values
      for(const p of PEOPLE){
        const sel = box.querySelector(`select[data-score="${cssEscape(p)}"]`);
        if(sel) sel.value = (j.scores?.[p] ?? '').toString();
      }

      // bind score change
      box.querySelectorAll('select[data-score]').forEach(sel=>{
        sel.addEventListener('change', async ()=>{
          const who = sel.getAttribute('data-score');
          const val = sel.value || '';
          this.setMsg(`Sparar poäng för ${who}…`);

          try{
            const payload = { scores: JSON.stringify({ [who]: val }) };
            const r = await api('saveScores', payload);
            if(!r?.ok) throw new Error(r?.error || 'saveScores');
            this.setMsg('OK – poäng sparad.');
          }catch(e){
            this.setMsg('Fel – kunde inte spara poäng.');
          }
        });
      });

      this.setMsg('');
    }catch(e){
      this.setMsg('Fel – kunde inte ladda.');
    }
  }
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
function cssEscape(s){
  // minimal safe escape for attribute selector
  return String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}