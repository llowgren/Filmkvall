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
    const email = getLocalEmail(who);

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

        <label class="muted" style="display:block;margin:.75rem 0 .25rem 0">
          E-post för betygslänk
        </label>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="emailInput" type="email" autocomplete="email" inputmode="email" value="${escapeAttr(email)}" placeholder="namn@example.com" style="flex:1 1 220px;min-width:0">
          <button id="emailSave" class="ghost" type="button">Spara</button>
          <button id="emailTest" class="ghost" type="button">Testa</button>
        </div>
        <div id="emailMsg" class="muted" style="margin-top:.4rem;font-size:12px"></div>
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
      this.bind();
    });

    this.querySelector('#emailSave')?.addEventListener('click', () => this.saveEmail());
    this.querySelector('#emailTest')?.addEventListener('click', () => this.testEmail());
    this.querySelector('#emailInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveEmail();
      }
    });
  }

  async saveEmail() {
    const who = (this.querySelector('#whoSelect')?.value || '').trim();
    const email = (this.querySelector('#emailInput')?.value || '').trim();
    const msg = this.querySelector('#emailMsg');
    const btn = this.querySelector('#emailSave');
    if (!who) return;

    if (email && !isValidEmail(email)) {
      if (msg) msg.textContent = 'Ogiltig e-postadress.';
      return;
    }

    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Sparar...';

    try {
      const j = await postBackend('saveUserEmail', { person: who, email });
      if (!j?.ok) throw new Error(j?.error || 'Kunde inte spara e-post');
      setLocalEmail(who, email);
      if (msg) msg.textContent = email ? 'Sparad.' : 'E-post borttagen.';
    } catch (e) {
      if (msg) msg.textContent = String(e?.message || e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async testEmail() {
    const who = (this.querySelector('#whoSelect')?.value || '').trim();
    const email = (this.querySelector('#emailInput')?.value || '').trim();
    const msg = this.querySelector('#emailMsg');
    const btn = this.querySelector('#emailTest');
    if (!who) return;

    if (!email || !isValidEmail(email)) {
      if (msg) msg.textContent = 'Fyll i en giltig e-postadress först.';
      return;
    }

    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Skickar test...';

    try {
      const saved = await postBackend('saveUserEmail', { person: who, email });
      if (!saved?.ok) throw new Error(saved?.error || 'Kunde inte spara e-post');
      setLocalEmail(who, email);

      const j = await postBackend('sendTestRatingEmails', {
        who,
        film: `Testfilm för ${who}`
      });
      if (!j?.ok) throw new Error(j?.error || 'Kunde inte skicka test');

      const sent = Number(j.mail?.sent || 0);
      const dev = Number(j.mail?.development || 0);
      if (msg) {
        msg.textContent = sent
          ? 'Testmejl skickat.'
          : (dev ? 'Testmejl skapat i DevEmails.' : 'Test klart, men ingen mottagare hittades.');
      }
    } catch (e) {
      if (msg) msg.textContent = String(e?.message || e);
    } finally {
      if (btn) btn.disabled = false;
    }
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function emailKey(who) {
  return `film_email_${String(who || '').trim().toLowerCase()}`;
}

function getLocalEmail(who) {
  try { return localStorage.getItem(emailKey(who)) || ''; } catch { return ''; }
}

function setLocalEmail(who, email) {
  try {
    const key = emailKey(who);
    if (email) localStorage.setItem(key, email);
    else localStorage.removeItem(key);
  } catch {}
}

async function postBackend(action, params = {}) {
  const body = new URLSearchParams({
    action,
    pw: AUTH.pw,
    ...params
  });

  const r = await fetch(API_URL, {
    method: 'POST',
    body,
    cache: 'no-store'
  });
  return r.json();
}
