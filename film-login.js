// film-login.js
// Central source of truth + Login UI (person selector)

import { setAuth, getWho, setWho, on } from './store.js';

// ================================
// CONFIG
// ================================
const API_URL =
  'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';

const AUTH = {
  pw: 'Look4fun',
  token: '__TOKEN__'
};

const TOKENS = {
  tmdb: 'e207103e8a03559e4be5970b8c899122',
  omdb: 'b6f3e48',
  watchmode: '6fs0TqcE6LrZttIvVKKJ1Heg97B161Ay1HntH9Vq'
};

// ================================
// Exports used by other modules
// ================================
export function getApiUrl() {
  return API_URL;
}

export function getMovieTokens() {
  return { ...TOKENS };
}

// Init auth early
setAuth(AUTH);

// ================================
// Web Component: <film-login>
// ================================
const PEOPLE = ['Maria', 'Lars', 'Hannah', 'Tuva', 'Alva'];

class FilmLogin extends HTMLElement {
  connectedCallback() {
    this.render();

    // uppdatera dropdown om "who" ändras någon annanstans
    this._off = on?.('who', (w) => {
      const sel = this.querySelector('select');
      if (sel && sel.value !== w) sel.value = w;
      const whoEl = this.querySelector('[data-who]');
      if (whoEl) whoEl.textContent = w;
    });
  }

  disconnectedCallback() {
    if (this._off) this._off();
  }

  render() {
    const current = getWho?.() || 'Maria';

    this.innerHTML = `
      <section class="card">
        <div class="row" style="align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <h3 style="margin:0;">Login</h3>
            <div class="muted">Inloggad: <span data-who>${current}</span></div>
          </div>

          <label class="muted" style="display:flex; align-items:center; gap:8px;">
            Person
            <select id="whoSelect">
              ${PEOPLE.map(p => `<option ${p === current ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </label>
        </div>
      </section>
    `;

    const sel = this.querySelector('#whoSelect');
    sel.addEventListener('change', () => setWho(sel.value));
  }
}

if (!customElements.get('film-login')) {
  customElements.define('film-login', FilmLogin);
}