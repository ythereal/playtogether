// TEST ONLY — stand-in for shared/net.js that relays messages between two iframes in _harness.html
window.PT = {
  room: async () => {
    const role = window.name;                                   // 'host' | 'guest'
    const peers = window.parent.PT_PEERS;
    const other = () => peers[role === 'host' ? 'guest' : 'host'];
    const r = {
      role, connected: false, _h: { message: [], connected: [], disconnected: [] },
      on(e, f) { this._h[e].push(f); if (e === 'connected' && this.connected) f(); return this; },
      send(d) { const o = other(); if (o && o.connected) setTimeout(() => o._h.message.forEach(f => f(JSON.parse(JSON.stringify(d)))), 0); },
      save(s) { sessionStorage.setItem('stub:' + role, JSON.stringify(s)); },
      get saved() { const s = sessionStorage.getItem('stub:' + role); return s ? JSON.parse(s) : null; },
      _drop() { this.connected = false; this._h.disconnected.forEach(f => f()); },
    };
    peers[role] = r;
    setInterval(() => {
      const o = other();
      if (o && !r.connected && window.parent.PT_LINK !== false) {
        const fire = !o.connected; r.connected = true; o.connected = true;
        r._h.connected.forEach(f => f()); if (fire) o._h.connected.forEach(f => f());
      }
    }, 150);
    return r;
  },
};
