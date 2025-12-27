// film-wishlist.js
// Uppdaterad layout: thumbnail vänster, IMDb bredvid, streaming höger (2 rader + expand)

import { store } from './store.js';
import { smartLookup, renderOmdbInfo } from './api.js';

customElements.define('film-wishlist', class extends HTMLElement {
  connectedCallback(){
    this.innerHTML = `
      <div class="card">
        <h3>Önskelista</h3>
        <div class="row" style="align-items:center">
          <div class="muted">Användare: <strong id="wlWho"></strong></div>
          <span class="right"></span>
          <button id="wlLoad" class="ghost">Hämta</button>
          <button id="wlSave" class="primary">Spara</button>
        </div>
        <div id="wlList"></div>
      </div>`;

    this.listEl = this.querySelector('#wlList');
    this.querySelector('#wlLoad').onclick = ()=>this.load();
    this.querySelector('#wlSave').onclick = ()=>this.save();

    store.subscribe(()=>this.render());
    this.render();
  }

  render(){
    const who = store.get('who');
    this.querySelector('#wlWho').textContent = who || '–';
  }

  async load(){
    const who = store.get('who');
    const wl = await store.api('getWishlist',{person:who});
    if(!wl?.ok) return;
    this.draw([wl.R1,wl.R2,wl.R3,wl.R4,wl.R5]);
  }

  async save(){
    const who = store.get('who');
    const rows = [...this.listEl.querySelectorAll('[data-i]')]
      .map(r=>r.querySelector('input').value);
    await store.api('saveWishlist',{
      person:who,
      R1:rows[0]||'',R2:rows[1]||'',R3:rows[2]||'',R4:rows[3]||'',R5:rows[4]||''
    });
  }

  draw(values){
    this.listEl.innerHTML = '';
    values.forEach((v,i)=>this.addRow(i+1,v));
  }

  addRow(i,value){
    const row = document.createElement('div');
    row.className = 'wishlist-row';
    row.dataset.i = i;
    row.innerHTML = `
      <div class="wishlist-input">
        <input value="${value||''}" placeholder="#${i}" autocomplete="off" />
        <button class="ghost">Sök</button>
        <div class="wishlist-move">
          <button class="ghost" data-move="up">▲</button>
          <button class="ghost" data-move="down">▼</button>
        </div>
      </div>
      <div class="wishlist-meta"></div>`;

    const input = row.querySelector('input');
    const meta  = row.querySelector('.wishlist-meta');

    row.querySelector('button.ghost').onclick = async ()=>{
      const data = await smartLookup(input.value);
      // visa streaming som i now-blocket
      renderOmdbInfo(meta, data, input.value, { withStreaming:true, layout:'side' });
    };

    this.listEl.appendChild(row);
  }
});

/* CSS (läggs i styles.css)
.wishlist-row{margin:12px 0}
.wishlist-input{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center}
.wishlist-meta{display:flex;gap:12px;margin-top:6px}
.wishlist-meta img{width:90px;border-radius:8px}
.wishlist-meta .streaming-wrap{margin-left:auto;max-width:55%}
.streaming-row{display:flex;flex-wrap:wrap;gap:4px;max-height:48px;overflow:hidden}
*/
