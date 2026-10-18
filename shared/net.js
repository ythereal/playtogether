/*
 * PlayTogether networking — shared by every game.
 *
 * Usage inside a game page:
 *   <script src="../../shared/net.js"></script>
 *   const room = await PT.room({ game: 'tictactoe', title: 'Tic-Tac-Toe' });
 *   room.role            // 'host' or 'guest'
 *   room.send(data)      // any JSON-serialisable value
 *   room.on('message',   data => {})
 *   room.on('connected', () => {})   // fires on every (re)connect — host should send full state here
 *   room.on('disconnected', () => {})
 *   room.save(state) / room.saved   // host: persist state across reloads (sessionStorage)
 *
 * The overlay (host / join / invite link / reconnecting) is drawn by this file,
 * so games never deal with codes or PeerJS directly.
 *
 * Reloading is safe: the room code lives in the URL, the host re-registers the
 * same code and the guest keeps retrying until it reconnects.
 */
(function () {
  'use strict';

  const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const ID_PREFIX = 'playtogether-v1-';
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LENGTH = 4;
  const PING_EVERY_MS = 2000;
  const DEAD_AFTER_MS = 7000;
  const RETRY_MS = 2000;
  const VERSION_POLL_MS = 60000;

  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const VERSION_URL = new URL('version.json', scriptUrl).href;
  const LOBBY_URL = new URL('../index.html', scriptUrl).href;

  // Optional: set window.PT_ICE_SERVERS before loading this file to add a TURN relay.
  const ICE_SERVERS = window.PT_ICE_SERVERS || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // ---------- helpers ----------
  function makeCode() {
    let s = '';
    const buf = new Uint32Array(CODE_LENGTH);
    crypto.getRandomValues(buf);
    for (const n of buf) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
    return s;
  }
  function cleanCode(c) {
    return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
  }
  function peerIdFor(game, code) { return ID_PREFIX + game + '-' + code; }

  let peerjsPromise = null;
  function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    if (!peerjsPromise) {
      peerjsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEERJS_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load PeerJS'));
        document.head.appendChild(s);
      });
    }
    return peerjsPromise;
  }

  async function fetchVersion() {
    try {
      const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return String(j.version);
    } catch (e) { return null; }
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  }

  // ---------- update banner ----------
  let loadedVersion = null;
  function showBanner(text) {
    let b = document.getElementById('pt-banner');
    if (!b) {
      b = el('div', { id: 'pt-banner', class: 'pt-banner', role: 'status' });
      document.body.appendChild(b);
    }
    b.replaceChildren(
      el('span', {}, text),
      el('button', { class: 'pt-btn pt-btn-small', onclick: () => location.reload() }, 'Reload')
    );
  }
  async function startVersionWatch() {
    loadedVersion = await fetchVersion();
    setInterval(async () => {
      const v = await fetchVersion();
      if (v && loadedVersion && v !== loadedVersion) showBanner('A new version is live.');
    }, VERSION_POLL_MS);
  }

  // ---------- overlay UI ----------
  function buildUI(title) {
    const pill = el('div', { class: 'pt-pill', hidden: '' });
    const lobby = el('a', { class: 'pt-lobby-link', href: LOBBY_URL }, '← All games');
    const body = el('div', { class: 'pt-card-body' });
    const card = el('div', { class: 'pt-card', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'pt-eyebrow' }, 'PlayTogether'),
      el('h2', { class: 'pt-title' }, title),
      body
    );
    const overlay = el('div', { class: 'pt-overlay' }, card);
    document.body.append(lobby, pill, overlay);
    return {
      pill, overlay, body,
      show(...kids) { body.replaceChildren(...kids); overlay.hidden = false; },
      hide() { overlay.hidden = true; },
    };
  }

  // ---------- Room ----------
  class Room {
    constructor(opts, ui) {
      this.game = opts.game;
      this.title = opts.title || opts.game;
      this.ui = ui;
      this.role = null;
      this.code = null;
      this.connected = false;
      this.peer = null;
      this.conn = null;
      this._handlers = { message: [], connected: [], disconnected: [] };
      this._lastSeen = 0;
      this._pingTimer = null;
      this._retryTimer = null;
    }

    on(event, fn) {
      (this._handlers[event] || (this._handlers[event] = [])).push(fn);
      if (event === 'connected' && this.connected) fn();
      return this;
    }
    _emit(event, arg) {
      for (const fn of this._handlers[event] || []) {
        try { fn(arg); } catch (e) { console.error('[PT] handler error', e); }
      }
    }
    send(data) {
      if (this.conn && this.conn.open) this.conn.send({ __pt: 'msg', d: data });
    }

    // Host-side persistence so a reload (e.g. after an update) resumes the same game.
    get _storeKey() { return 'pt:' + this.game + ':' + this.code; }
    save(state) {
      try { sessionStorage.setItem(this._storeKey, JSON.stringify(state)); } catch (e) {}
    }
    get saved() {
      try { const s = sessionStorage.getItem(this._storeKey); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }

    get inviteUrl() {
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      u.searchParams.set('room', this.code);
      return u.href;
    }

    _setUrl() {
      const u = new URL(location.href);
      u.searchParams.set('room', this.code);
      if (this.role === 'host') u.searchParams.set('host', '1');
      else u.searchParams.delete('host');
      history.replaceState(null, '', u.href);
    }

    _peerOptions() {
      // window.PT_PEER_SERVER (optional) = { host, port, path, secure } for a self-hosted PeerServer.
      return Object.assign({ debug: 1, config: { iceServers: ICE_SERVERS } }, window.PT_PEER_SERVER || {});
    }

    // ----- host -----
    host(code) {
      this.role = 'host';
      this.code = code || makeCode();
      this._setUrl();
      this._showWaiting('Starting room…');
      let attempts = 0;
      const open = () => {
        const peer = new Peer(peerIdFor(this.game, this.code), this._peerOptions());
        this.peer = peer;
        peer.on('open', () => { attempts = 0; this._showWaiting('Waiting for your friend…'); });
        peer.on('connection', conn => {
          if (this.conn && this.conn !== conn) { try { this.conn.close(); } catch (e) {} }
          this._attach(conn);
        });
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('error', err => {
          if (err.type === 'unavailable-id' && attempts < 15) {
            // Our previous tab (before reload) is still registered — wait for it to expire.
            attempts++;
            this._showWaiting('Reclaiming room ' + this.code + '…');
            peer.destroy();
            setTimeout(open, RETRY_MS);
          } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
            this._showWaiting('Matchmaking server unreachable, retrying…');
            peer.destroy();
            setTimeout(open, RETRY_MS * 2);
          } else if (err.type !== 'peer-unavailable') {
            this._showError(err);
          }
        });
      };
      open();
    }

    // ----- guest -----
    join(code) {
      this.role = 'guest';
      this.code = cleanCode(code);
      this._setUrl();
      this._showJoining('Connecting to room ' + this.code + '…');
      const hostId = peerIdFor(this.game, this.code);
      const startPeer = () => {
        const peer = new Peer(this._peerOptions());
        this.peer = peer;
        const tryConnect = () => {
          clearTimeout(this._retryTimer);
          if (this.connected || peer.destroyed) return;
          if (peer.disconnected) { peer.reconnect(); }
          const conn = peer.connect(hostId, { reliable: true });
          const timeout = setTimeout(() => { if (!conn.open) { try { conn.close(); } catch (e) {} retry(); } }, 8000);
          conn.on('open', () => clearTimeout(timeout));
          this._attach(conn, retry);
        };
        const retry = () => {
          clearTimeout(this._retryTimer);
          this._retryTimer = setTimeout(tryConnect, RETRY_MS);
        };
        this._guestRetry = retry;
        peer.on('open', tryConnect);
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('error', err => {
          if (err.type === 'peer-unavailable') {
            this._showJoining('Waiting for the host to open room ' + this.code + '…');
            retry();
          } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
            this._showJoining('Matchmaking server unreachable, retrying…');
            peer.destroy();
            setTimeout(startPeer, RETRY_MS * 2);
          } else {
            this._showError(err);
          }
        });
      };
      startPeer();
    }

    // ----- shared connection plumbing -----
    _attach(conn, onLost) {
      this.conn = conn;
      let lostFired = false;
      const lost = () => {
        if (lostFired || this.conn !== conn) return;
        lostFired = true;
        clearInterval(this._pingTimer);
        const was = this.connected;
        this.connected = false;
        this.conn = null;
        if (was) this._emit('disconnected');
        if (this.role === 'host') this._showWaiting('Your friend disconnected. They can rejoin with the same link.');
        else { this._showJoining('Connection lost, reconnecting…'); if (onLost) onLost(); }
      };
      conn.on('open', () => {
        this.connected = true;
        this._lastSeen = Date.now();
        conn.send({ __pt: 'hello', v: loadedVersion, role: this.role });
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
          if (Date.now() - this._lastSeen > DEAD_AFTER_MS) { try { conn.close(); } catch (e) {} lost(); return; }
          if (conn.open) conn.send({ __pt: 'ping' });
        }, PING_EVERY_MS);
        this.ui.hide();
        this._updatePill();
        this._emit('connected');
      });
      conn.on('data', m => {
        this._lastSeen = Date.now();
        if (!m || typeof m !== 'object') return;
        if (m.__pt === 'msg') this._emit('message', m.d);
        else if (m.__pt === 'hello' && m.v && loadedVersion && m.v !== loadedVersion) {
          showBanner('You and your friend are on different versions. Both reload.');
        }
      });
      conn.on('close', lost);
      conn.on('error', lost);
    }

    _updatePill() {
      const p = this.ui.pill;
      p.hidden = false;
      p.className = 'pt-pill' + (this.connected ? ' is-on' : '');
      p.replaceChildren(
        el('span', { class: 'pt-dot' }),
        (this.connected ? 'Connected' : 'Offline') + ' · ' + this.code + ' · ' + (this.role === 'host' ? 'Host' : 'Guest')
      );
    }

    _showWaiting(status) {
      this._updatePill();
      const copyBtn = el('button', { class: 'pt-btn' }, 'Copy invite link');
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(this.inviteUrl); copyBtn.textContent = 'Copied!'; }
        catch (e) { prompt('Copy this link:', this.inviteUrl); }
        setTimeout(() => (copyBtn.textContent = 'Copy invite link'), 1800);
      });
      this.ui.show(
        el('p', { class: 'pt-muted' }, 'Send your friend this code or the invite link'),
        el('div', { class: 'pt-code', 'aria-label': 'Room code' }, this.code),
        el('div', { class: 'pt-row' }, copyBtn),
        el('p', { class: 'pt-status' }, el('span', { class: 'pt-spinner' }), status)
      );
    }

    _showJoining(status) {
      this._updatePill();
      this.ui.show(
        el('div', { class: 'pt-code pt-code-small' }, this.code),
        el('p', { class: 'pt-status' }, el('span', { class: 'pt-spinner' }), status),
        el('div', { class: 'pt-row' }, el('a', { class: 'pt-btn pt-btn-ghost', href: location.pathname }, 'Use a different code'))
      );
    }

    _showError(err) {
      console.error('[PT]', err);
      this.ui.show(
        el('p', { class: 'pt-error' }, 'Something went wrong: ' + (err.type || err.message || err)),
        el('div', { class: 'pt-row' }, el('button', { class: 'pt-btn', onclick: () => location.reload() }, 'Try again'))
      );
    }
  }

  // ---------- entry point ----------
  async function room(opts) {
    if (!opts || !opts.game) throw new Error('PT.room needs { game }');
    const ui = buildUI(opts.title || opts.game);
    startVersionWatch();
    const params = new URLSearchParams(location.search);
    const urlCode = cleanCode(params.get('room'));
    const r = new Room(opts, ui);

    const peerReady = loadPeerJS().catch(err => { r._showError(err); throw err; });

    let choice;
    if (urlCode.length === CODE_LENGTH) {
      choice = { role: params.get('host') === '1' ? 'host' : 'guest', code: urlCode };
    } else {
      choice = await new Promise(resolve => {
        const input = el('input', {
          class: 'pt-input', maxlength: String(CODE_LENGTH), placeholder: 'CODE',
          autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Room code',
        });
        const joinBtn = el('button', { class: 'pt-btn', type: 'submit' }, 'Join');
        input.addEventListener('input', () => { input.value = cleanCode(input.value); });
        const form = el('form', { class: 'pt-join' }, input, joinBtn);
        form.addEventListener('submit', e => {
          e.preventDefault();
          const c = cleanCode(input.value);
          if (c.length === CODE_LENGTH) resolve({ role: 'guest', code: c });
          else input.focus();
        });
        ui.show(
          el('button', { class: 'pt-btn pt-btn-big', onclick: () => resolve({ role: 'host' }) }, 'Host a game'),
          el('div', { class: 'pt-or' }, 'or join a friend'),
          form
        );
      });
    }
    r.role = choice.role;
    r.code = choice.code || makeCode();
    await peerReady;
    setTimeout(() => (choice.role === 'host' ? r.host(r.code) : r.join(r.code)), 0);
    return r;
  }

  window.PT = { room, makeCode };
})();
