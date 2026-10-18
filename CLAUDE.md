# PlayTogether: notes for Claude Code

A static, two-player browser game hub hosted on **GitHub Pages** at
`https://ythereal.github.io/playtogether/`. It has no build step and no server. Players connect
peer-to-peer through PeerJS (WebRTC), and PeerJS's free public server handles matchmaking only.

## Layout

```
index.html              Lobby. Renders every game in games/games.js
shared/net.js           Networking + host/join overlay. Exposes window.PT
shared/style.css        Design tokens (light/dark) + overlay/chrome styles
shared/version.json     Bumped on every deploy, drives the "new version" banner
games/games.js          Game registry (window.PT_GAMES)
games/<id>/index.html   One folder per game, self-contained
```

## Hard rules

1. **Bump `shared/version.json` in every commit that changes anything players load.**
   Increment the number by 1. Open tabs poll it and show a "Reload" banner.
2. **Use only relative paths.** The site is served from `/playtogether/`, not `/`.
   A game links `../../shared/net.js` and `../../shared/style.css`.
3. **Don't modify `shared/net.js` while adding or editing a game.** Change it only when the
   networking itself needs a fix, and keep its public API backwards-compatible, because every game depends on it.
4. No build tools, bundlers or npm dependencies. Plain HTML/CSS/JS that works when served as static files.
   CDN scripts are fine but must use a pinned version.
5. Every game must work on a phone (touch, ~375px wide) as well as a desktop.

## Adding a game

1. Create `games/<id>/index.html` (`<id>` is lowercase, no spaces). Copy the skeleton of
   `games/tictactoe/index.html`: link `../../shared/style.css`, load `../../shared/net.js`,
   and wrap content in `<main class="game"><div class="game-inner">…`.
2. Add an entry to `games/games.js`: `{ id, name, blurb, icon, type }`.
3. Bump `shared/version.json`.
4. Commit and push to `main`. Pages redeploys in about 1 minute.

### Reference games: copy the closest one

- `games/tictactoe`: smallest turn-based example.
- `games/connect4`: turn-based with animation and keyboard shortcuts.
- `games/battleship`: **hidden information**. The host keeps the full state but sends each player
  only `viewFor(state, player)`, so the guest never receives the host's ship positions. Use this
  pattern for anything with secret hands, fog of war, etc.
- `games/pong`: **real-time** (host simulation, 30 Hz snapshots, guest interpolation, local
  prediction of your own paddle, guest view mirrored so you're always at the bottom).

## Networking API (`window.PT`)

```js
const room = await PT.room({ game: '<id>', title: 'Display Name' });
room.role                          // 'host' | 'guest'
room.connected                     // boolean
room.send(anyJson)                 // to the other player
room.on('message', data => {})
room.on('connected', () => {})     // every connect AND reconnect
room.on('disconnected', () => {})
room.save(state)                   // host: persist state (sessionStorage) …
room.saved                         // … and read it back after a reload, or null
```

The overlay (host button, code entry, invite link, reconnecting screen) is drawn by net.js.
Games never touch PeerJS directly. Reloads reconnect automatically to the same room, because
the code is kept in the URL (`?room=CODE`, and `&host=1` for the host).

## Required game pattern: the host is authoritative

- The **host** owns the canonical `state` object and runs all the rules.
- The **guest** sends only *intents*, e.g. `{ type: 'move', i: 4 }`, never state.
- The host validates each intent, updates state, then sends `{ type: 'state', state }`.
- On `'connected'` the host **must send the full state**. That makes reconnects and mid-game reloads work.
- The host initialises with `room.saved || newState()` and calls `room.save(state)` whenever state
  changes, so the game survives the host reloading after an update. Real-time games can save
  just scores and round info, not every frame.
- Both sides render purely from `state`. Rendering must not mutate it.
- Keep rules in pure functions (`newState`, `applyMove`) separate from networking and view code.

For **real-time games** (pong, racing, etc.):
- The host runs the simulation loop (`requestAnimationFrame` or a fixed 60 Hz tick).
- The guest sends its input state (e.g. `{ type: 'input', up: true }`) whenever it changes.
- The host broadcasts compact snapshots 20–30×/sec. It must not send them every frame.
- The guest interpolates between the last two snapshots so motion looks smooth.
- Use plain numbers and short keys in snapshots to keep messages small.
- Make sure the host's own input is applied locally with no network round-trip.

## Testing locally

Serve the folder with `python3 -m http.server 8000`. Open `http://localhost:8000/games/<id>/`
in two browser tabs, host in one, and join with the code in the other. PeerJS works between
two tabs on the same machine. Check that a game resumes correctly after reloading either tab mid-game.

## If connections fail on some networks

Strict NATs need a TURN relay. Set `window.PT_ICE_SERVERS = [...]` in a `<script>` before
`net.js` loads (e.g. from a free Metered/Cloudflare TURN account). Don't commit secret
credentials. Ask the user first.
