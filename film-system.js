// film-system.js
import { getWho, getAuth, on } from './store.js';
import { getApiUrl, getMovieTokens } from './film-login.js';

customElements.define('film-system', class extends HTMLElement {
  connectedCallback() {
    this.render();
    this.unsubWho = on('who', () => this.render());
    this.unsubAuth = on('auth', () => this.render());
  }

  disconnectedCallback() {
    this.unsubWho?.();
    this.unsubAuth?.();
  }

  render() {
    const who = getWho();
    const auth = getAuth();
    const apiUrl = getApiUrl();
    const tokens = getMovieTokens();

    const view = {
      who,
      apiUrl,
      auth: {
        pw: auth.pw ? '(satt)' : '',
        token: auth.token ? '(satt)' : ''
      },
      tokens: {
        tmdb: !!tokens.tmdb,
        omdb: !!tokens.omdb,
        watchmode: !!tokens.watchmode
      }
    };

    this.innerHTML = `
      <div class="card">
        <h3>System</h3>
        <div class="muted" style="font-size:13px">Felsökning/status</div>
        <pre style="white-space:pre-wrap;margin:10px 0 0">${escapeHtml(JSON.stringify(view, null, 2))}</pre>
      </div>
    `;
  }
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}