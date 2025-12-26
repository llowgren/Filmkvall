import { getAuth } from './store.js';
import { getApiUrl, getMovieTokens } from './film-login.js';

customElements.define('film-system', class extends HTMLElement {
  connectedCallback(){ this.render(); }

  render(){
    const auth = getAuth();
    const url = getApiUrl();
    const t = getMovieTokens();

    this.innerHTML = `
      <div class="card">
        <h3>System</h3>
        <div class="muted" style="font-size:13px">Felsökning/status</div>
        <pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify({
          apiUrl: url,
          auth: { pw: auth.pw ? '(satt)' : '', token: auth.token ? '(satt)' : '' },
          tokens: { tmdb: !!t.tmdb, omdb: !!t.omdb, watchmode: !!t.watchmode }
        }, null, 2))}</pre>
      </div>`;
  }
});

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }