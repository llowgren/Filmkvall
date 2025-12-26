// film-login.js
// Central source of truth for API URL, auth, tokens + UI for choosing user (Användare)

import { setAuth, getWho, setWho } from './store.js';

// ================================
// CONFIG (centralised here on purpose)
// ================================

// Backend Web App URL (Google Apps Script)
const API_URL =
  'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';

// Authentication towards backend (legacy pw and/or token)
const AUTH = {
  pw: 'Look4fun',
  token: '__TOKEN__' // placeholder for now
};

// External movie data providers
const TOKENS = {
  tmdb: 'e207103e8a03559e4be5970b8c899122',
  omdb: 'b6f3e48',
  watchmode: '6fs0TqcE6LrZttIvVKKJ1Heg97B161Ay1HntH9Vq'
};

// Users shown in dropdown (scalable later)
const USERS = ['Maria', 'Lars', 'Hannah', 'Tuva', 'Alva'];

// ================================
// Public API (used by other modules)
// ================================

export function getApiUrl() {
  return API_URL;
}

export function getMovieTokens() {
  return { ...TOKENS };
}

export function getUsers() {
  return [...USERS];
}

// ================================
// Initialization (important)
// ================================

// Write auth once on load so all modules can read from store
setAuth(AUTH);

// ================================
// Web Component: <film-login>
// ================================

class FilmLogin extends HTMLElement {
  connectedCallback() {
    this.render();
    this.bind();
  }

  render() {
    const who = (typeof getWho === 'function' ? getWho() : 'Maria') || 'Maria';

    this.innerHTML = `
      <section class="card">
        <h2 style="margin:0 0 .25rem 0">Login</h2>
        <div class="muted" style="margin:0 0 .75rem 0">Inloggad: <strong>${escapeHtml(
          who
        )}</strong></div>

        <label class="muted" style="display:block;margin:0 0 .25rem 0">
          Användare
        </label>

        <select id="whoSelect" style="width:100%">
          ${USERS.map(
            (u) =>
              `<option value="${escapeAttr(u)}" ${
                u === who ? 'selected' : ''
              }>${escapeHtml(u)}</option>`
          ).join('')}
        </select>
      </section>
    `;
  }

  bind() {
    const sel = this.querySelector('#whoSelect');
    if (!sel) return;

    sel.addEventListener('change', () => {
      const v = String(sel.value || '').trim();
      if (typeof setWho === 'function') setWho(v);
      this.render(); // refresh "Inloggad: ..."
    });
  }
}

if (!customElements.get('film-login')) {
  customElements.define('film-login', FilmLogin);
}

// ================================
// Small helpers
// ================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}