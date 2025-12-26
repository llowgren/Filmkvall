import { getWho, setWho, getAuth, setAuth, on } from '../store.js';

customElements.define('film-login', class extends HTMLElement {
  connectedCallback(){
    this.render();
    this.bind();
    this.syncFromStore();
    this.unsub = on('who', ()=>this.syncFromStore());
  }
  disconnectedCallback(){
    this.unsub?.();
  }

  render(){
    this.innerHTML = `
      <div class="card" id="userCard" style="padding:8px 12px; max-width:260px">
        <label>Användare</label>
        <select id="who"></select>

        <!-- Auth-fält kan vara dolda/enkla nu. Vi gör dem “förberedda”. -->
        <div style="margin-top:10px; display:none" id="authBox">
          <label>Token</label>
          <input id="token" autocomplete="off" />
          <label style="margin-top:6px">PW</label>
          <input id="pw" autocomplete="off" />
        </div>
      </div>
    `;
  }

  bind(){
    const whoSel = this.querySelector('#who');
    whoSel.addEventListener('change', ()=> setWho(whoSel.value));

    // Förberett: om ni senare visar authBox
    const tokenEl = this.querySelector('#token');
    const pwEl = this.querySelector('#pw');
    tokenEl.addEventListener('change', ()=> setAuth({ token: tokenEl.value.trim() }));
    pwEl.addEventListener('change', ()=> setAuth({ pw: pwEl.value.trim() }));
  }

  syncFromStore(){
    const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars']; // kan flyttas senare
    const whoSel = this.querySelector('#who');
    whoSel.innerHTML = PEOPLE.map(p=>`<option value="${p}">${p}</option>`).join('');
    whoSel.value = getWho();

    const a = getAuth();
    this.querySelector('#token').value = a.token || '';
    this.querySelector('#pw').value = a.pw || '';
  }
});