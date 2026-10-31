(function () {
  const D = LAUNCHER_DATA;
  const stage = document.getElementById('stage');
  const APP = Object.fromEntries(D.apps.map((a) => [a.id, a]));

  // Start in the host's theme (an explicit data-theme, else the OS setting). Dark when unknown.
  function initialTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  const state = {
    appearance: 'auto', // 'auto' (follow the TV/host) | 'light' | 'dark'
    theme: initialTheme(), // resolved 'dark' | 'light'
    iconStyle: 'default', // 'default' | 'dark' | 'clear' | 'tinted'
    sampleData: true, // off = preview the empty states real data may need
    live: false, // on the TV: a media session is playing
    wallpaper: D.wallpapers.length ? 'photo' : 'gradient', // 'gradient' | 'photo'
    wallpaperName: D.wallpapers[0]?.name || null, // which photo
    glow: null, // colour of the edge glow and focus ring; null = the room light
    govee: { hasKey: false, connected: false, devices: [], error: '' }, // from the Android side
    homeDefault: false, // this launcher is the TV's home app
    setupOpen: false,
    // Tinted icons (Customize): colour from the room light or a hue of your own,
    // warmth 0 (cool) to 100 (warm), opacity 10 to 100.
    tint: { source: 'room', hue: 200, warmth: 50, opacity: 60 },
    view: 'home',
    playing: true,
    track: 0,
    pos: D.music.startPositionSec,
    query: '',
    town: '', // weather town set by the user; empty = use the TV's location
    weather: null, // {town, temp, high, low, label, icon, palette}; sample in the preview
    weatherNote: 'loading', // 'loading' | 'permission' | 'offline' | 'notfound' | ''
    games: { ...D.games },
    roles: {}, // light id -> role (see ROLES)
    spread: true, // a backlight scene also colours the lights that have a role
    ambient: 10, // minutes idle before the ambient screen; 0 = off
    sleepAt: 0, // when the sleep timer turns the lights off (ms), or 0
    motion: 'smooth', // 'smooth' or 'fast' (no animations)
    speed: '', // result of the last speed test
    settingsCat: null, // which Settings group is open
    cw: [], // Watch Next items read from the TV
    cwNote: '',
    matchLights: false, // wallpaper gradient follows the backlight colours
    home: {
      backlight: NATIVE ? 'none' : D.smartHome.backlights.start, // scene id, 'none' (not chosen yet), 'sync' or 'off'
      lastScene: NATIVE ? 'none' : D.smartHome.backlights.start, // colours used while syncing or off
      scene: null, // room scene last applied
      lights: Object.fromEntries(D.smartHome.lights.map((l) => [l.id, l.on])),
      drift: false, // slowly moves the backlight through the scene's colours
      sound: { on: true, volume: D.smartHome.soundbar.volume, max: D.smartHome.soundbar.volumeMax, muted: false },
    },
  };

  const COUNTDOWN_STEPS = [0, 3, 5, 10];
  const RING_C = 2 * Math.PI * 34;

  const H = D.smartHome;
  const BACKLIGHT = Object.fromEntries(H.backlights.scenes.map((s) => [s.id, s]));
  BACKLIGHT.live = { id: 'live', name: 'Following your lights', colors: ['#8e8e9a', '#6b6b78', '#4a4a55'] };
  BACKLIGHT.none = { id: 'none', name: 'Pick a scene', colors: ['#8e8e9a', '#6b6b78', '#4a4a55'] };
  const ROOM_SCENE = Object.fromEntries(H.scenes.map((s) => [s.id, s]));

  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Saved settings ----------
  // Remembered on the TV between launches (browser storage inside the app).
  const SAVED = ['motion', 'roles', 'spread', 'ambient', 'appearance', 'iconStyle', 'wallpaper', 'wallpaperName', 'matchLights', 'town', 'tint'];

  function loadSaved() {
    try {
      const o = JSON.parse(localStorage.getItem('settings') || '{}');
      SAVED.forEach((k) => { if (o[k] !== undefined) state[k] = o[k]; });
      if (o.games) Object.assign(state.games, o.games);
    } catch {
      // Nothing saved yet, or storage is unavailable.
    }
    if (!D.wallpapers.some((w) => w.name === state.wallpaperName)) state.wallpaperName = D.wallpapers[0]?.name || null;
    if (state.wallpaper === 'photo' && !state.wallpaperName) state.wallpaper = 'gradient';
  }

  let saveTimer;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const o = Object.fromEntries(SAVED.map((k) => [k, state[k]]));
        o.games = { hdmiPort: state.games.hdmiPort, autoSwitch: state.games.autoSwitch, countdownSec: state.games.countdownSec };
        localStorage.setItem('settings', JSON.stringify(o));
      } catch {
        // Not saved; it just won't be remembered.
      }
    }, 300);
  }

  // ---------- Colours ----------
  // Everything derived from the light colour, the theme or the tint sliders is
  // worked out here and handed to the CSS as plain values (see color.js).
  function applyColors() {
    const dark = state.theme === 'dark';
    const [c0, c1, c2] = BACKLIGHT[state.home.lastScene].colors;
    const glow = state.glow || c0;
    const set = (k, v) => stage.style.setProperty(k, v);

    set('--glowc', glow);
    set('--glow-a', withAlpha(glow, dark ? 0.8 : 0.55));
    set('--focus', dark ? mixHex(glow, '#ffffff', 0.45) : mixHex(glow, '#15151d', 0.55));
    set('--focus-glow', withAlpha(glow, dark ? 0.5 : 0.35));

    // Wallpaper that follows the lights
    [c0, c1, c2].forEach((c, i) => {
      set(`--lw${i}`, dark ? withAlpha(c, [0.42, 0.38, 0.4][i]) : mixHex(c, '#ffffff', [0.45, 0.4, 0.4][i]));
    });

    // Tinted icons
    const t = state.tint;
    let base = t.source === 'room' ? c0 : hslToHex(t.hue, 0.7, 0.58);
    const w = (t.warmth - 50) / 50;
    if (w > 0) base = mixHex('#ffb35c', base, w * 0.55);
    else if (w < 0) base = mixHex('#6fa8ff', base, -w * 0.55);
    const a = t.opacity / 100;
    set('--tint-bg1', withAlpha(mixHex(base, '#000000', 0.55), 0.22 + 0.6 * a));
    set('--tint-bg2', withAlpha(mixHex(base, '#000000', 0.8), 0.18 + 0.55 * a));
    set('--tint-glyph', !dark && a < 0.5 ? mixHex(base, '#000000', 0.5) : mixHex(base, '#ffffff', 0.65));
    set('--tint-base', base);
  }
  const fmt = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
  const track = () => D.music.tracks[state.track];
  const appName = (id) => APP[id].short || APP[id].name;

  // ---------- Markup ----------

  function nowPlayingControls() {
    return `
      <div class="np-controls">
        <div class="track"><div class="fill" data-progress></div></div>
        <div class="np-row">
          <span class="small tnum" data-elapsed></span>
          <div class="transport">
            <button class="ctrl lg" data-focus data-action="prev" aria-label="Previous">${icon('prev', 18)}</button>
            <button class="play" data-focus data-action="play"></button>
            <button class="ctrl lg" data-focus data-action="next" aria-label="Next">${icon('next', 18)}</button>
          </div>
          <span class="small tnum" data-duration></span>
        </div>
      </div>`;
  }

  // Home: an iPad-style widget grid and a glass dock of apps, sized for a TV.
  function homeView() {
    const w = D.weather;
    const h = D.hero;
    return `
      <section class="view view-home" data-view="home">
        <div class="widgets">
          <button class="widget glass w-room" data-focus data-expand="room" aria-label="Room: lights and scenes">
            <span class="w-label">Room</span>
            <span class="w-room-row"><span class="w-room-swatch" data-room-swatch></span><span data-room-scene></span></span>
            <span class="w-room-row">${icon('lamp', 20)}<span data-room-lights></span></span>
            <span class="w-room-row">${icon('speaker', 20)}<span data-room-sound></span></span>
          </button>

          <section class="widget glass tinted w-weather" data-weather-card data-focus data-expand="weather" tabindex="0" aria-label="Weather">
            <div class="tint"></div>
            <button class="w-empty" tabindex="-1" data-nav-to="settings">
              ${icon('location', 28)}
              <span class="w-empty-title" data-w-empty-title></span>
              <span class="small" data-w-empty-text></span>
            </button>
            <div class="w-weather-top">
              <span class="w-label" data-w-town></span>
              <span class="w-weather-icon" data-w-icon></span>
            </div>
            <div class="temp" data-w-temp></div>
            <div class="w-weather-foot">
              <span data-w-label></span>
              <span class="small" data-w-range></span>
            </div>
          </section>

          <section class="widget glass now-playing tinted w-music" data-np-card data-focus data-expand="music" tabindex="0" aria-label="Now playing">
            <div class="tint"></div>
            ${npEmpty()}
            <div class="np-top">
              <div class="np-meta">
                <div class="np-title" data-np-title></div>
                <div class="sub" data-np-artist></div>
              </div>
              <div class="np-art" data-np-art></div>
            </div>
            <div class="np-next">
              <div class="np-next-label">Up next</div>
              <div data-np-next></div>
            </div>
            ${nowPlayingControls()}
          </section>

          <section class="widget hero w-hero" aria-label="Continue watching" ${NATIVE ? '' : 'data-focus data-expand="hero" tabindex="0"'}>
            <div class="w-empty w-jump">
              <span class="w-empty-title" data-jump-title>Jump back in</span>
              <div class="jump-row" data-jump></div>
            </div>
            <div class="hero-art" style="background:${h.art}"></div>
            <div class="hero-shade"></div>
            <div class="hero-body">
              <div class="hero-app"><span class="dot" style="background:${h.appColor}"></span>${h.app}</div>
              <div class="hero-row">
                <div>
                  <div class="hero-title">${h.title}</div>
                  <div class="hero-sub">${h.subtitle}</div>
                </div>
                <button class="resume" data-focus data-wn="0" data-toast="Resuming ${h.title} on ${h.app}">${filledIcon('play', 14)} Resume</button>
              </div>
              <div class="hero-progress">
                <div class="hero-track"><div style="width:${h.progress}%"></div></div>
                <span class="hero-left">${h.left}</span>
              </div>
            </div>
          </section>

          <section class="widget glass w-scenes" data-scenes hidden aria-label="Scenes">
            <span class="w-label">Scenes</span>
            <div class="scene-grid">
              ${['movie', 'gaming', 'relax', 'night'].map((id) => `<button class="pillbtn" data-focus data-action="room-scene" data-id="${id}">${ROOM_SCENE[id]?.name || id}</button>`).join('')}
            </div>
          </section>

          ${NATIVE ? [0, 1].map((i) => `<button class="widget glass w-mini" data-cw data-i="${i}" hidden data-focus data-expand="cw"></button>`).join('') : ''}
          ${D.continueWatching.map((c) => `
            <button class="widget glass w-mini" data-cw data-focus data-expand="cw" data-i="${D.continueWatching.indexOf(c)}" aria-label="Continue ${c.title} on ${c.app}">
              <span class="w-mini-art" style="background:${c.art}">${appIcon(APP[c.appId], 30)}</span>
              <span class="w-mini-title">${c.title}</span>
              <span class="small">${c.meta}</span>
              <span class="track"><span class="fill" style="width:${c.progress}%"></span></span>
            </button>`).join('')}
        </div>

        <nav class="dock glass" aria-label="Apps">
          ${dockApps().map((a, i, list) => `
            
            <button class="dock-app" data-focus data-app="${a.id}" aria-label="${a.name}" style="--accent:${a.color}">
              ${appIcon(a, 76)}
              <span class="dock-label">${a.short || a.name}</span>
            </button>`).join('')}
        </nav>
      </section>`;
  }

  // The dock shows the apps listed in data.js (dock), in that order, if installed.
  // If fewer than three of them are installed, other apps fill it so it is never bare.
  function dockApps() {
    const list = D.dock.map((id) => D.apps.find((a) => a.id === id)).filter(Boolean);
    D.apps.forEach((a) => { if (list.length < 3 && !list.includes(a)) list.push(a); });
    return list;
  }

  function appTile(a, cls, size) {
    return `
      <button class="${cls}" data-focus data-app="${a.id}" aria-label="${a.name}"
        style="--accent:${a.color};--glow:${a.color}55">
        ${appIcon(a, size)}
        <span class="app-name">${a.short || a.name}</span>
      </button>`;
  }

  function searchView() {
    return `
      <section class="view view-search" data-view="search" hidden>
        <label class="search-bar glass">
          <span class="lg chip" style="width:40px;height:40px;border-radius:50%">${icon('search', 18)}</span>
          <input id="search-input" data-focus type="search" enterkeyhint="search" inputmode="search" autocomplete="off" spellcheck="false"
            placeholder="Search apps and shows" aria-label="Search">
          <span class="small" data-search-count></span>
          <button class="btn lg google-search" data-focus data-action="google-search">Search with Google TV</button>
        </label>
        ${NATIVE ? `
        <div class="search-section">
          <div class="eyebrow" data-titles-head hidden>Shows and films</div>
          <div class="shows" data-shows="titles"></div>
          <p class="small" data-titles-note></p>
          <div class="eyebrow" data-apps-head>Apps on this TV</div>
          <div class="shows" data-shows="apps"></div>
          <p class="small search-hint" data-search-hint></p>
        </div>` : `
        <div class="search-section">
          <div class="eyebrow">Free on your apps</div>
          <div class="shows" data-shows="free"></div>
        </div>
        <div class="search-section">
          <div class="eyebrow">Rent or buy</div>
          <div class="shows" data-shows="paid"></div>
        </div>`}
      </section>`;
  }

  function showCard(s) {
    const a = APP[s.app];
    const paid = s.offer.kind === 'rent' || s.offer.kind === 'buy';
    const verb = s.offer.kind === 'rent' ? 'Rent' : 'Buy';
    const label = paid ? `${s.title} on ${a.name}, ${verb.toLowerCase()} for ${s.offer.price}` : `${s.title} on ${a.name}, free`;
    const toast = paid ? `${verb} ${s.title} on ${a.name} for ${s.offer.price}` : `Opening ${s.title} in ${a.name}`;
    return `
      <button class="show glass" data-focus data-toast="${toast}" aria-label="${label}">
        <div class="show-art" style="background:${s.art}">
          <span class="show-app">${appIcon(a, 34)}</span>
          ${paid ? `<span class="price lg"><span class="price-kind">${verb}</span>${s.offer.price}</span>` : ''}
        </div>
        <div class="show-body">
          <div class="show-title">${s.title}</div>
          <div class="small show-meta">${s.meta}</div>
        </div>
      </button>`;
  }

  // Shown instead of the Now playing card when nothing is playing, or when
  // the launcher hasn't been allowed to see what's playing yet.
  function npEmpty() {
    return `
      <div class="w-empty">
        ${icon('music', 34)}
        <span class="w-empty-title" data-np-empty-title>Nothing playing</span>
        <span class="small" data-np-empty-text></span>
        <button class="btn lg" data-focus data-action="grant-np" data-np-allow hidden>Allow access</button>
        <button class="btn lg" data-focus data-app="ytmusic" data-np-open hidden>Open YouTube Music</button>
      </div>`;
  }

  function musicView() {
    const sb = H.soundbar;
    return `
      <section class="view view-music" data-view="music" hidden>
        <section class="card glass music-empty-card tinted" data-music-empty hidden>
          <div class="tint"></div>
          ${npEmpty()}
        </section>
        <div class="music-grid">
          <section class="card glass music-now tinted" data-np-card aria-label="Now playing">
            <div class="tint"></div>
            <div class="music-art" data-np-art></div>
            <div class="music-meta">
              <div class="music-source"><span data-np-src-icon="30"></span><span data-np-source></span></div>
              <div>
                <div class="music-title" data-np-title></div>
                <div class="sub" data-np-artist></div>
              </div>
              ${nowPlayingControls()}
            </div>
          </section>
          <section class="card glass music-queue" aria-label="Up next">
            <div class="music-queue-title">Up next</div>
            <div class="queue" data-queue></div>
          </section>
        </div>
        <section class="card glass soundbar" aria-label="Soundbar">
          <div class="room-head">
            <span class="lg chip room-chip">${icon('speaker')}</span>
            <span class="room-title">Soundbar<span class="small" data-sound-status></span></span>
            <div class="volume">
              <button class="ctrl lg" data-focus data-action="vol-down" aria-label="Volume down">${icon('minus', 18)}</button>
              <span class="track vol-track"><span class="fill" data-vol-fill></span></span>
              <span class="vol-num tnum" data-vol></span>
              <button class="ctrl lg" data-focus data-action="vol-up" aria-label="Volume up">${icon('plus', 18)}</button>
              <button class="ctrl lg" data-focus data-action="mute" aria-label="Mute">${icon('volume', 18)}</button>
            </div>
          </div>
        </section>
        <div class="music-mixes">
          <div class="eyebrow">Your mixes</div>
          <div class="mixes">
            ${D.music.mixes.map((m) => `
              <button class="mix glass" data-focus data-toast="Playing ${m.title} on ${D.music.source}">
                <div class="mix-art" style="background:${m.art}"></div>
                <div class="mix-title">${m.title}</div>
                <div class="small">${m.sub}</div>
              </button>`).join('')}
          </div>
        </div>
      </section>`;
  }

  function appsView() {
    return `
      <section class="view view-apps" data-view="apps" hidden>
        <div class="app-grid">
          ${D.apps.map((a) => appTile(a, 'app-card glass', 68)).join('')}
        </div>
      </section>`;
  }

  function gamesView() {
    return `
      <section class="view view-games" data-view="games" hidden>
        <section class="card glass games-hero">
          <span class="lg chip games-chip">${icon('games', 48)}</span>
          <div class="games-text">
            <div class="games-title">${state.games.device} on <span data-val="hdmi"></span></div>
            <div class="sub" data-games-sub></div>
            <div class="games-actions">
              <button class="btn btn-primary" data-focus data-action="switch-now">Switch to ${state.games.device} now</button>
              <button class="btn lg" data-focus data-action="toggle-auto">Auto-switch: <span data-val="auto"></span></button>
            </div>
          </div>
        </section>
      </section>`;
  }

  function roomView() {
    return `
      <section class="view view-room" data-view="room" hidden>
        <div class="room-grid">
          <section class="card glass room-card" aria-label="${H.backlights.name}">
            <div class="room-head">
              <span class="lg chip room-chip">${icon('room')}</span>
              <span class="room-title">${H.backlights.name}<span class="small" data-backlight-status></span></span>
              <button class="btn lg" data-focus data-action="open-roles">Light roles</button>
              <button class="btn lg tog" data-focus data-action="spread"><span>Spread to room</span><span class="switch" aria-hidden="true"><span></span></span><span data-val="spread" hidden></span></button>
              <button class="btn lg tog" data-focus data-action="drift"><span>Animate</span><span class="switch" aria-hidden="true"><span></span></span><span data-val="drift" hidden></span></button>
              <button class="btn lg tog" data-focus data-action="match-lights"><span>Wallpaper follows lights</span><span class="switch" aria-hidden="true"><span></span></span><span data-val="match" hidden></span></button>
            </div>
            <div class="swatches">
              <button class="swatch" data-focus data-action="backlight" data-id="sync">
                <span class="swatch-dot lg chip">${icon('sync', 26)}</span><span class="small">Sync to TV</span>
              </button>
              ${H.backlights.scenes.map((s) => `
                <button class="swatch" data-focus data-action="backlight" data-id="${s.id}">
                  <span class="swatch-dot" style="background:linear-gradient(135deg,${s.colors.join(',')})"></span>
                  <span class="small">${s.name}</span>
                </button>`).join('')}
              <button class="swatch" data-focus data-action="backlight" data-id="off">
                <span class="swatch-dot lg chip">${icon('power', 22)}</span><span class="small">Off</span>
              </button>
            </div>
          </section>

          <section class="card glass room-card" aria-label="Room lights">
            <div class="room-head">
              <span class="lg chip room-chip">${icon('lamp')}</span>
              <span class="room-title">Room lights<span class="small">${H.provider}</span></span>
            </div>
            <div class="pill-row">
              ${H.scenes.map((sc) => `<button class="pillbtn" data-focus data-action="room-scene" data-id="${sc.id}">${sc.name}</button>`).join('')}
              <button class="pillbtn" data-focus data-action="sleep"><span data-sleep-label>Sleep timer: Off</span></button>
            </div>
            <div class="light-list" data-light-list></div>
          </section>
        </div>

      </section>`;
  }

  // ---------- Jump back in: the apps you opened last ----------
  // Remembered when you open an app from here, so it needs no permission.
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('recent') || '[]'); } catch { recent = []; }

  function noteLaunch(id) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    try { localStorage.setItem('recent', JSON.stringify(recent)); } catch { /* not remembered */ }
  }

  function renderJump() {
    const el = stage.querySelector('[data-jump]');
    if (!el) return;
    const used = recent.map((id) => APP[id]).filter(Boolean);
    const list = (used.length ? used : dockApps()).slice(0, 4);
    stage.querySelector('[data-jump-title]').textContent = used.length ? 'Jump back in' : 'Your apps';
    el.innerHTML = list.map((a) => `
      <button class="jump" data-focus data-app="${a.id}" aria-label="Open ${esc(a.name)}">
        ${appIcon(a, 64)}
        <span class="small">${esc(a.short || a.name)}</span>
      </button>`).join('');
  }

  // ---------- Continue watching (the TV's Watch Next list) ----------
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const appByPkg = (pkg) => D.apps.find((a) => a.pkg === pkg);

  function leftText(pos, dur) {
    if (!(dur > 0)) return '';
    const m = Math.max(0, Math.round((dur - pos) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`;
  }

  function cwShape(it) {
    const app = appByPkg(it.pkg);
    const poster = /^https?:/.test(it.poster) ? `url("${it.poster}") center / cover no-repeat, ` : '';
    return {
      title: it.title,
      subtitle: it.sub,
      meta: it.sub,
      app: app ? app.name : '',
      appId: app ? app.id : null,
      appColor: app ? app.color : '#8e8e9a',
      art: `${poster}linear-gradient(135deg, #2a2a38, #14141c)`,
      progress: it.dur > 0 ? Math.min(100, Math.round((it.pos / it.dur) * 100)) : 0,
      left: leftText(it.pos, it.dur),
      uri: it.uri,
      pkg: it.pkg,
    };
  }

  function renderContinue() {
    if (!NATIVE) return;
    const r = nativeJson('watchNext') || { ok: false, error: 'unavailable', items: [] };
    state.cw = (r.items || []).filter((i) => i.title).map(cwShape);
    state.cwNote = r.ok ? '' : r.error === 'permission' ? 'permission' : r.error;
    D.hero = state.cw[0] || D.hero;
    D.continueWatching = state.cw.slice(1, 3);
    const hero = stage.querySelector('.w-hero');
    const h = state.cw[0];
    hero.toggleAttribute('data-focus', !!h);
    hero.toggleAttribute('data-expand', !!h);
    hero.setAttribute('tabindex', h ? '0' : '-1');
    hero.dataset.expand = h ? 'hero' : '';
    if (h) {
      hero.querySelector('.hero-art').style.background = h.art;
      hero.querySelector('.hero-app').innerHTML = `<span class="dot" style="background:${esc(h.appColor)}"></span>${esc(h.app)}`;
      hero.querySelector('.hero-title').textContent = h.title;
      hero.querySelector('.hero-sub').textContent = h.subtitle;
      hero.querySelector('.hero-track > div').style.width = `${h.progress}%`;
      hero.querySelector('.hero-left').textContent = h.left;
    }
    all('[data-cw]').forEach((el) => {
      const c = state.cw[Number(el.dataset.i) + 1];
      el.dataset.wn = String(Number(el.dataset.i) + 1);
      if (!c) { el.innerHTML = ''; return; }
      const app = APP[c.appId] || { name: c.app || '?', color: '#8e8e9a', mark: (c.app || '?').slice(0, 1) };
      el.setAttribute('aria-label', `Continue ${c.title}`);
      el.innerHTML = `<span class="w-mini-art" style="background:${c.art}">${appIcon(app, 30)}</span><span class="w-mini-title">${esc(c.title)}</span><span class="small">${esc(c.meta || c.left)}</span><span class="track"><span class="fill" style="width:${c.progress}%"></span></span>`;
    });
    applyState();
  }

  // ---------- Show search (TMDB) ----------
  // Titles come from TMDB, and which services carry them from its watch
  // provider data (supplied by JustWatch). Only services you have installed
  // are offered. TMDB gives no prices.
  let tmdbKey = '';
  const tmdbReady = () => NATIVE && !!tmdbKey;

  function tmdb(path, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    const bearer = tmdbKey.length > 40;
    if (!bearer) url.searchParams.set('api_key', tmdbKey);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return getJson(url.toString(), bearer ? { Authorization: `Bearer ${tmdbKey}` } : undefined);
  }

  const normName = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIAS = { amazonvideo: 'primevideo', amazonprimevideo: 'primevideo', amazonprimevideowithads: 'primevideo' };

  function appForProvider(name) {
    let n = normName(name);
    n = ALIAS[n] || n;
    return D.apps.find((a) => normName(a.name) === n)
      || D.apps.find((a) => { const m = normName(a.name); return m.length > 3 && n.includes(m); });
  }

  function pickApp(g) {
    const first = (kinds) => (kinds || []).map((p) => appForProvider(p.provider_name)).find(Boolean);
    const stream = first(g.flatrate) || first(g.free) || first(g.ads);
    if (stream) return { app: stream, how: 'Watch on' };
    const pay = first(g.rent) || first(g.buy);
    return pay ? { app: pay, how: 'Rent or buy on' } : null;
  }

  function renderTitles(rows, q) {
    const el = stage.querySelector('[data-shows="titles"]');
    const head = stage.querySelector('[data-titles-head]');
    const note = stage.querySelector('[data-titles-note]');
    if (!el) return;
    head.hidden = !rows.length && !note.textContent;
    el.innerHTML = rows.map(({ h, g }) => {
      const pick = pickApp(g);
      const title = h.title || h.name || '';
      const year = (h.release_date || h.first_air_date || '').slice(0, 4);
      const poster = h.poster_path ? `background:url("https://image.tmdb.org/t/p/w342${h.poster_path}") center / cover` : 'background:linear-gradient(135deg,#2a2a38,#14141c)';
      const line = pick ? `${pick.how} ${pick.app.name}` : 'Not on your apps';
      return `
        <button class="show glass" data-focus ${pick ? `data-app="${pick.app.id}"` : 'data-toast="That title isn\'t on any of your apps"'} aria-label="${esc(title)}. ${esc(line)}">
          <div class="show-art" style="${poster}">${pick ? `<span class="show-app">${appIcon(pick.app, 34)}</span>` : ''}</div>
          <div class="show-body"><div class="show-title">${esc(title)}</div><div class="small show-meta">${[year, h.media_type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')}<br>${esc(line)}</div></div>
        </button>`;
    }).join('');

  }

  let tmdbTimer = 0;
  let tmdbSeq = 0;
  function queueTmdb(q) {
    clearTimeout(tmdbTimer);
    const note = stage.querySelector('[data-titles-note]');
    if (!note) return;
    note.textContent = '';
    if (!tmdbReady() || q.length < 2) {
      renderTitles([], '');
      return;
    }
    tmdbTimer = setTimeout(async () => {
      const seq = ++tmdbSeq;
      note.textContent = 'Searching...';
      try {
        const r = await tmdb('search/multi', { query: q, include_adult: 'false', language: 'en-GB' });
        const words = q.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
        const hasWords = (x) => {
          const t = `${x.title || x.name || ''} ${x.original_title || x.original_name || ''}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '');
          return words.every((w) => t.includes(w));
        };
        // TMDB matches loosely: keep only titles that really contain what was typed.
        const hits = (r.results || []).filter((x) => (x.media_type === 'movie' || x.media_type === 'tv') && hasWords(x)).slice(0, 10);
        const rows = await Promise.all(hits.map(async (h) => {
          try {
            const p = await tmdb(`${h.media_type}/${h.id}/watch/providers`);
            return { h, g: (p.results || {}).GB || {} };
          } catch {
            return { h, g: {} };
          }
        }));
        if (seq !== tmdbSeq) return;
        // Only titles one of your installed apps carries.
        const onYourApps = rows.filter(({ g }) => pickApp(g)).slice(0, 5);
        note.textContent = onYourApps.length ? '' : `Nothing on your apps matches “${q}”.`;
        renderTitles(onYourApps, q);
      } catch {
        if (seq === tmdbSeq) {
          note.textContent = "Couldn't reach TMDB. Check the key on the phone page and the connection.";
          renderTitles([], q);
        }
      }
    }, 600);
  }

  // ---------- Frost that lines up with the wallpaper ----------
  // Each glass panel paints the blurred wallpaper offset by where it sits on
  // screen, so it shows the part of the photo that is really behind it.
  function stagePos(el, sr, k) {
    const r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k };
  }

  // Measured at most a few times a second, and only after the page really
  // changes (cards added or removed, a view opening, scrolling), never on every
  // focus move. All measuring happens first, then all writing, so it forces
  // one layout and no more.
  let frostTimer = 0;
  function alignFrost(delay = 140) {
    if (frostTimer) return;
    frostTimer = setTimeout(() => {
      frostTimer = 0;
      requestAnimationFrame(measureFrost);
    }, delay);
  }

  function measureFrost() {
    if (state.wallpaper !== 'photo') return;
    const sr = stage.getBoundingClientRect();
    const k = sr.width / 1280 || 1;
    const todo = [];
    stage.querySelectorAll('.glass').forEach((el) => {
      if (!el.offsetParent) return; // hidden
      const r = el.getBoundingClientRect();
      const x = Math.round((r.left - sr.left) / k);
      const y = Math.round((r.top - sr.top) / k);
      if (el.__fx !== x || el.__fy !== y) todo.push([el, x, y]);
    });
    todo.forEach(([el, x, y]) => {
      el.__fx = x;
      el.__fy = y;
      el.style.setProperty('--fx', `${-x}px`);
      el.style.setProperty('--fy', `${-y}px`);
    });
  }

  // ---------- Speed test ----------
  // Moves focus around every tab by itself and times the frames, so the numbers
  // come from this TV, not from a guess.
  let speedRunning = false;
  async function runSpeedTest() {
    if (speedRunning) return;
    speedRunning = true;
    toast('Speed test. Keep your hands off the remote');
    const frames = [];
    const delays = [];
    let last = performance.now();
    let on = true;
    const loop = (t) => {
      frames.push(t - last);
      last = t;
      if (on) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dirs = ['right', 'right', 'left', 'down', 'up', 'right', 'left', 'down'];
    for (const tab of ['home', 'search', 'music', 'apps', 'room', 'settings', 'home']) {
      stage.querySelector(`.topbar [data-nav="${tab}"]`)?.click();
      await wait(350);
      for (let round = 0; round < 2; round++) {
        for (const d of dirs) {
          const t0 = performance.now();
          moveFocus(d);
          await frame2();
          delays.push(performance.now() - t0);
          await wait(110);
        }
      }
    }
    on = false;
    const f = frames.slice(5).sort((a, b) => a - b);
    const avg = f.reduce((a, b) => a + b, 0) / (f.length || 1);
    const slow = Math.round((100 * f.filter((x) => x > 34).length) / (f.length || 1));
    const d = delays.slice().sort((a, b) => a - b);
    const lag = d.length ? d[Math.floor(d.length * 0.9)] : 0;
    const rating = avg <= 18 && slow <= 5 ? 'Smooth' : avg <= 28 && slow <= 20 ? 'OK' : 'Slow';
    state.speed = `${rating}: ${Math.round(avg)} ms a frame, ${slow}% slow, ${Math.round(lag)} ms to react`;
    speedRunning = false;
    openView('settings');
    applyState();
    toast(state.speed);
  }

  // ---------- Cards that open into a window ----------
  // Selecting a Home card grows it into a panel with quick actions or details.
  let xFrom = null;

  const wx = () => (state.weather && state.weather.extra) || null;

  function xContent(kind) {
    const close = '<button class="btn lg x-close" data-focus data-action="x-close">Close</button>';
    if (kind === 'room') {
      const lights = roomLights();
      const h = state.home;
      return `
        <div class="x-head"><span class="x-title">Room</span>${close}</div>
        <div class="pill-row">${H.scenes.map((sc) => `<button class="pillbtn" data-focus data-action="room-scene" data-id="${sc.id}">${sc.name}</button>`).join('')}</div>
        <div class="x-swatches">
          <button class="swatch" data-focus data-action="backlight" data-id="sync"><span class="swatch-dot lg chip">${icon('sync', 22)}</span><span class="small">Sync</span></button>
          ${H.backlights.scenes.map((s) => `<button class="swatch" data-focus data-action="backlight" data-id="${s.id}"><span class="swatch-dot" style="background:linear-gradient(135deg,${s.colors.join(',')})"></span><span class="small">${s.name}</span></button>`).join('')}
          <button class="swatch" data-focus data-action="backlight" data-id="off"><span class="swatch-dot lg chip">${icon('power', 20)}</span><span class="small">Off</span></button>
        </div>
        <div class="x-lights" style="--rows:${Math.max(1, Math.ceil(Math.min(lights.length, 10) / 2))}">
          ${lights.slice(0, 10).map((l) => `<button class="light-row" data-focus data-action="light" data-id="${l.id}"><span class="light-dot"></span><span class="light-name">${l.name}</span><span class="switch" aria-hidden="true"><span></span></span></button>`).join('')
            || '<span class="small">No lights yet. Connect Govee in Settings.</span>'}
        </div>
        <div class="x-foot"><span class="small">${lights.filter((l) => h.lights[l.id]).length} of ${lights.length} lights on</span><button class="btn lg" data-focus data-nav-to="room">All room controls</button></div>`;
    }
    if (kind === 'weather') {
      const w = state.weather;
      if (!w) return `<div class="x-head"><span class="x-title">Weather</span>${close}</div><p class="small">No weather yet. Check the TV is online, or add your town in Settings.</p><button class="btn lg" data-focus data-nav-to="settings">Open Settings</button>`;
      const e = wx();
      const stat = (label, v) => `<div class="x-stat"><span class="small">${label}</span><span class="x-val">${v}</span></div>`;
      return `
        <div class="x-head"><span class="x-title">${w.town}</span>${close}</div>
        <div class="x-weather"><span class="x-bigicon">${icon(w.icon, 64)}</span><span class="x-temp">${w.temp}°</span><span class="x-cond">${w.label}<span class="small">High ${w.high}°, low ${w.low}°</span></span></div>
        ${e ? `<div class="x-stats">${stat('Feels like', `${e.feels}°`)}${stat('Wind', `${e.wind} mph`)}${stat('Humidity', `${e.humidity}%`)}</div>
        <div class="x-hours">${e.hours.map((hr) => `<div class="x-hour"><span class="small">${hr.at}</span><span class="x-val">${hr.temp}°</span><span class="small">${hr.rain}%</span></div>`).join('')}</div>` : '<p class="small">More detail appears at the next refresh.</p>'}
        <button class="btn lg" data-focus data-action="x-close">Done</button>`;
    }
    if (kind === 'music') {
      const open = APP.ytmusic && (!NATIVE || /youtube music/i.test(track().source || ''));
      return `
        <div class="x-head"><span class="x-title">Now playing</span>${close}</div>
        <div class="x-music">
          <div class="x-art" data-np-art></div>
          <div class="x-music-body">
            <div class="x-song" data-np-title></div>
            <div class="sub" data-np-artist></div>
            ${nowPlayingControls()}
            ${open ? '<button class="btn lg" data-focus data-app="ytmusic">Open YouTube Music</button>' : ''}
          </div>
        </div>`;
    }
    const c = kind === 'hero' ? { ...D.hero, meta: D.hero.subtitle, appId: D.hero.appId } : D.continueWatching[Number(xFrom?.dataset.i)] || D.continueWatching[0];
    if (!c) return '';
    return `
      <div class="x-head"><span class="x-title">${c.title}</span>${close}</div>
      <div class="x-cw"><div class="x-cw-art" style="background:${c.art}"></div>
        <div class="x-cw-body"><span class="small">${c.app || ''}</span><span class="x-val">${c.meta || ''}</span>
          <div class="track"><div class="fill" style="width:${c.progress}%"></div></div>
          <span class="small">${c.left || ''}</span>
          <button class="btn lg btn-primary" data-focus ${NATIVE ? `data-wn="${kind === 'hero' ? 0 : Number(xFrom?.dataset.i) + 1}"` : ''} data-toast="Resuming ${c.title} on ${c.app}">Resume${c.app ? ` in ${c.app}` : ''}</button>
        </div></div>`;
  }

  function openExpand(card) {
    xFrom = card;
    refs.xpanel.innerHTML = xContent(card.dataset.expand);
    refs.x.hidden = false;
    refs.x.classList.remove('closing');
    // Grow from the card: start at its size and place, ease to the panel's.
    const from = card.getBoundingClientRect();
    const to = refs.xpanel.getBoundingClientRect();
    const k = userFitScale();
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / k;
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / k;
    refs.xpanel.style.transition = 'none';
    refs.xpanel.style.transform = `translate(${dx}px, ${dy}px) scale(${Math.max(0.3, from.width / to.width)}, ${Math.max(0.3, from.height / to.height)})`;
    refs.xpanel.style.opacity = '0.4';
    refs.xpanel.getBoundingClientRect();
    refs.xpanel.style.transition = '';
    refs.xpanel.style.transform = '';
    refs.xpanel.style.opacity = '';
    if (card.dataset.expand === 'music') { renderTrack(); renderPlayButtons(); updatePlayback(); }
    applyState();
    (refs.xpanel.querySelector('[data-focus]:not(.x-close)') || refs.xpanel.querySelector('[data-focus]'))?.focus();
  }

  function closeExpand() {
    if (refs.x.hidden) return;
    refs.x.classList.add('closing');
    setTimeout(() => {
      refs.x.hidden = true;
      refs.x.classList.remove('closing');
      refs.xpanel.innerHTML = '';
      (xFrom && xFrom.isConnected ? xFrom : stage.querySelector('.dock-app'))?.focus();
      xFrom = null;
    }, 280);
  }

  // The page is drawn scaled to the screen; getBoundingClientRect reports screen pixels.
  function userFitScale() {
    const m = /scale\(([\d.]+)\)/.exec(stage.style.transform || '');
    return m ? parseFloat(m[1]) || 1 : 1;
  }

  // ---------- Light roles ----------
  // Each light can be given a place in the room. A backlight scene then colours
  // the cabinet, lamp and monitor lights from its palette, and the ceiling
  // lights go off for Movie, Gaming and the ambient screen.
  const ROLES = [
    { id: '', label: 'Not set' },
    { id: 'ceiling', label: 'Ceiling (main)' },
    { id: 'lamp', label: 'Lamp' },
    { id: 'cabinet', label: 'TV cabinet' },
    { id: 'monitor', label: 'Monitor' },
  ];

  function rolesView() {
    return `
      <section class="view view-roles" data-view="roles" hidden>
        <section class="card glass cleanup" data-roles-list aria-label="Light roles"></section>
      </section>`;
  }

  function renderRoles() {
    const list = stage.querySelector('[data-roles-list]');
    const lights = roomLights();
    list.innerHTML = '<p class="small cleanup-note">Press OK on a light to choose where it is. Lights with no place are left alone by scenes.</p>'
      + (lights.length ? lights.map((l) => `
        <button class="set-row" data-focus data-action="cycle-role" data-id="${l.id}">
          <span class="lg chip set-chip">${icon('lamp')}</span>
          <span class="set-label">${l.name}</span>
          <span class="set-val">${ROLES.find((r) => r.id === (state.roles[l.id] || '')).label}</span>
        </button>`).join('') : '<div class="cleanup-empty"><span class="w-empty-title">No lights yet</span><span class="small">Connect your Govee account first.</span></div>');
  }

  const lightsWithRole = (role) => roomLights().filter((l) => state.roles[l.id] === role);

  // Colours a backlight scene's palette across the lights that have a place.
  function spreadColors(colors) {
    if (!state.spread) return;
    const plan = { cabinet: colors[0], monitor: colors[1], lamp: colors[2] };
    Object.entries(plan).forEach(([role, hex]) => {
      lightsWithRole(role).forEach((l) => {
        state.home.lights[l.id] = true;
        if (!NATIVE) return;
        if (l.color) {
          const [r, g, b] = hexToRgb(hex);
          nativeCall('goveeColor', l.id, r, g, b);
        } else {
          nativeCall('goveePower', l.id, true);
        }
      });
    });
  }

  // ---------- Guest Wi-Fi ----------
  function guestView() {
    return `
      <section class="view view-guest" data-view="guest" hidden>
        <section class="card glass guest" data-guest aria-label="Guest Wi-Fi"></section>
      </section>`;
  }

  function guestInfo() {
    if (!NATIVE) return { ssid: 'Guest network', payload: 'WIFI:T:WPA;S:Guest network;P:sample-only;;' };
    return nativeJson('guestWifi') || {};
  }

  function renderGuest() {
    const box = stage.querySelector('[data-guest]');
    const info = guestInfo();
    if (!info.ssid) {
      box.innerHTML = `<div class="cleanup-empty"><span class="w-empty-title">No guest network yet</span>
        <span class="small">Open Set up from your phone, add the network name and password under Guest Wi-Fi, and it appears here as a code.</span></div>`;
      return;
    }
    const q = qrcode(0, 'M');
    q.addData(info.payload);
    q.make();
    const n = q.getModuleCount();
    let rects = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) rects += `<rect x="${x + 4}" y="${y + 4}" width="1.02" height="1.02"/>`;
    box.innerHTML = `
      <div class="qr"><svg viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges" aria-label="Wi-Fi code"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><g fill="#000">${rects}</g></svg></div>
      <div class="guest-text">
        <div class="w-empty-title">${info.ssid.replace(/</g, '&lt;')}</div>
        <span class="small">Point a phone camera at the code to join. The password is in the code and is not shown here.</span>
        ${NATIVE ? '' : '<span class="small">Sample code, not a real network.</span>'}
      </div>`;
  }

  function settingsRow(chip, label, help, control) {
    return `
      <span class="lg chip set-chip">${chip}</span>
      <span class="set-label">${label}<span class="small">${help}</span></span>
      ${control}`;
  }

  function settingsView() {
    const row = (action, chip, label, help, val) => `
      <button class="set-row" data-focus data-action="${action}">
        ${settingsRow(chip, label, help, `<span class="set-val" data-val="${val}"></span>`)}
      </button>`;
    const town = `
      <label class="set-row">
        ${settingsRow(icon('location'), 'Weather town', 'Leave empty to use the TV location', '<input id="town-input" class="set-input" data-focus autocomplete="off" spellcheck="false" placeholder="TV location">')}
      </label>`;
    // Settings are grouped: a short list of categories, each opening its own rows.
    const cats = [
      { id: 'display', icon: icon('image'), title: 'Display', help: 'Appearance, wallpaper, screen size, ambient screen', rows: [
        row('theme', '<span data-theme-icon></span>', 'Appearance', 'Light, dark, or follow the TV', 'theme'),
        row('wallpaper', icon('image'), 'Wallpaper', 'Photo, gradient, or your light colours', 'wallpaper'),
        row('open-wallpapers', icon('image'), 'Wallpaper photos', 'Choose one, or add your own', 'wp'),
        row('screen-fit', icon('live'), 'Screen size', 'Resize if the edges are cropped', 'fit'),
        row('cycle-ambient', icon('moon'), 'Ambient screen', 'Photos and clock when idle', 'ambient'),
        row('cycle-motion', icon('live'), 'Animations', 'Fast turns them off, for a slow TV', 'motion'),
        row('speed-test', icon('timer'), 'Speed test', 'Moves around by itself for about 20 seconds. Hands off', 'speed'),
        NATIVE ? '' : row('toggle-sample', icon('apps'), 'Sample content', 'Turn off to see empty widgets', 'sample'),
      ] },
      { id: 'home', icon: icon('home'), title: 'Home and apps', help: 'Home button, clean up apps', rows: [
        row('home-role', icon('home'), 'Home button', 'Which app opens on Home', 'home'),
        row('open-cleanup', icon('power'), 'Clean up apps', 'Switch off apps you don\'t want', 'cleanup'),
        NATIVE ? row('grant-np', icon('music'), 'Now playing access', 'Show what is playing', 'np-access') : '',
        NATIVE ? row('wn-check', icon('live'), 'Continue watching check', 'What the TV shares from your apps', 'wn') : '',
      ] },
      { id: 'lights', icon: icon('lamp'), title: 'Lights', help: 'Govee account, light roles', rows: [
        row('open-setup', icon('lamp'), 'Govee account', 'Lights and backlight', 'govee'),
        row('open-roles', icon('room'), 'Light roles', 'Where each light is in the room', 'roles'),
      ] },
      { id: 'games', icon: icon('games'), title: 'Games', help: 'Console input and switching', rows: [
        row('cycle-hdmi', icon('hdmi'), 'Games input', `Where the ${state.games.device} is plugged in`, 'hdmi'),
        row('toggle-auto', icon('games'), 'Switch input for Games', 'Turn off to stay here', 'auto'),
        row('cycle-countdown', icon('timer'), 'Switch countdown', 'Time to cancel first', 'countdown'),
      ] },
      { id: 'connect', icon: icon('phone'), title: 'Network and phone', help: 'Phone setup, guest Wi-Fi, weather town, Wi-Fi', rows: [
        row('open-setup', icon('phone'), 'Set up from your phone', 'Govee key, wallpapers, apps, Wi-Fi code', 'setup'),
        row('open-guest', icon('wifi'), 'Guest Wi-Fi', 'A code guests scan to join', 'guest'),
        town,
        row('wifi', icon('wifi'), 'Wi-Fi', 'Opens the TV network settings', 'wifi'),
      ] },
    ];
    return `
      <section class="view view-settings" data-view="settings" hidden>
        <section class="card glass settings" aria-label="Settings">
          <div class="set-col" data-set-menu>
            ${cats.map((c) => `
              <button class="set-row" data-focus data-action="settings-cat" data-cat="${c.id}">
                ${settingsRow(c.icon, c.title, c.help, '<span class="set-val set-more">&rsaquo;</span>')}
              </button>`).join('')}
          </div>
          ${cats.map((c) => `
            <div class="set-col" data-set-cat="${c.id}" hidden>
              <div class="set-head">${c.title}</div>
              ${c.rows.join('')}
            </div>`).join('')}
        </section>
      </section>`;
  }

  // Clean up apps: the apps agreed for switching off. Each row opens that
  // app's page in the TV's Settings; the Disable button there is yours to press.
  function cleanupView() {
    return `
      <section class="view view-cleanup" data-view="cleanup" hidden>
        <section class="card glass cleanup" data-cleanup-list aria-label="Clean up apps"></section>
      </section>`;
  }

  // The launcher's own link to this TV's debugging port. It only reads facts
  // for now; apps are switched off from the list below once it is agreed.
  function adbRow() {
    if (!NATIVE) return '';
    const a = state.adb || { state: 'idle' };
    const help = {
      idle: 'Lets the launcher switch apps off for you. Changes nothing yet',
      connecting: 'Connecting to the TV',
      working: a.message || 'Working',
      done: `${a.message || 'Done'}${a.failed && a.failed.length ? `. ${a.failed.length} could not be changed` : ''}`,
      approve: 'Allow it on the TV: press OK on the question that appears',
      ready: `${a.model || 'TV'}, Android ${a.android || '?'}. ${a.off ?? 0} apps already switched off`,
      error: a.message || "Couldn't connect",
    }[a.state] || '';
    const val = { idle: 'Press OK', connecting: '...', working: '...', approve: 'Waiting', ready: 'Connected', done: 'Connected', error: 'Try again' }[a.state] || '';
    return `
      <button class="set-row" data-focus data-action="adb-connect">
        <span class="lg chip set-chip">${icon('wifi')}</span>
        <span class="set-label">Connect to the TV<span class="small">${esc(help)}</span></span>
        <span class="set-val">${val}</span>
      </button>`;
  }

  // The agreed list plus whatever was ticked on the phone page.
  function cleanupItems() {
    const items = D.cleanup.map((c) => ({ pkg: c.pkg, reason: c.reason }));
    if (NATIVE) {
      (nativeJson('chosenApps') || []).forEach((c) => {
        if (!items.some((i) => i.pkg === c.pkg)) items.push({ pkg: c.pkg, reason: 'You chose this on your phone' });
      });
    }
    return items;
  }

  function renderCleanup() {
    const list = stage.querySelector('[data-cleanup-list]');
    const items = cleanupItems();
    if (!items.length) {
      list.innerHTML = adbRow() + `
        <div class="cleanup-empty">
          <span class="w-empty-title">No apps chosen</span>
          <span class="small">Open Set up from your phone, go to Apps to switch off, tick the apps you don't want and send them over. They are listed here, and you switch them off from this screen.</span>
        </div>`;
      return;
    }
    const states = NATIVE ? nativeJson('packageStates', JSON.stringify(items.map((c) => c.pkg))) || [] : [];
    const a = state.adb || {};
    const live = states.filter((st) => st.installed && st.enabled).length;
    const ready = ['ready', 'done'].includes(a.state);
    const actions = ready ? `
      ${live ? `<button class="set-row" data-focus data-action="adb-disable">
        <span class="lg chip set-chip">${icon('power')}</span>
        <span class="set-label">${state.adbConfirm ? 'Press OK again to switch off' : `Switch off ${live} chosen app${live === 1 ? '' : 's'}`}<span class="small">${state.adbConfirm ? 'You can switch them back on from this screen' : 'Reversible. You confirm once more first'}</span></span>
        <span class="set-val">${state.adbConfirm ? 'Confirm' : 'Press OK'}</span>
      </button>` : ''}
      ${a.ours ? `<button class="set-row" data-focus data-action="adb-restore">
        <span class="lg chip set-chip">${icon('power')}</span>
        <span class="set-label">Switch back on what I switched off<span class="small">${a.ours} app${a.ours === 1 ? '' : 's'}</span></span>
        <span class="set-val">Press OK</span>
      </button>` : ''}` : '';
    list.innerHTML = adbRow() + actions + '<p class="small cleanup-note">Press OK on an app to open its page. Disable switches it off; Enable brings it back, so nothing here is permanent.</p>' + items.map((c) => {
      const st = states.find((x) => x.pkg === c.pkg);
      const value = !NATIVE ? 'On the TV' : !st || !st.installed ? 'Not on this TV' : st.enabled ? 'On' : 'Off';
      return `
        <button class="set-row" data-focus data-action="open-app-info" data-pkg="${c.pkg}">
          <span class="lg chip set-chip">${icon('power')}</span>
          <span class="set-label">${esc(st ? st.label : c.pkg)}<span class="small">${esc(c.reason)}${value === 'Off' ? ' · Switched off. Press OK, then Enable, to bring it back.' : ''}</span></span>
          <span class="set-val">${value}</span>
        </button>`;
    }).join('');
  }

  // Wallpaper chooser. Built when it opens and emptied when it closes, so the
  // photos aren't all held in memory on a small TV.
  function wallpapersView() {
    return `
      <section class="view view-wallpapers" data-view="wallpapers" hidden>
        <div class="wp-grid" data-wp-grid></div>
      </section>`;
  }

  function renderWallpapers() {
    const grid = stage.querySelector('[data-wp-grid]');
    grid.innerHTML = `
      <button class="wp-tile wp-add" data-focus data-action="open-setup" aria-label="Add wallpapers from your phone">
        <span class="lg chip wp-add-chip">${icon('phone', 30)}</span>
        <span class="wp-name">Add from your phone</span>
      </button>
      ${D.wallpapers.map((w) => `
        <button class="wp-tile" data-focus data-action="pick-wallpaper" data-id="${w.name}" aria-label="${w.label}">
          <img src="${w.url}" alt="" decoding="async">
          <span class="wp-name">${w.label}</span>
          <span class="wp-check lg chip">${icon('check', 18)}</span>
        </button>`).join('')}`;
    markWallpaper();
  }

  function markWallpaper() {
    all('[data-action="pick-wallpaper"]').forEach((b) => {
      const on = b.dataset.id === state.wallpaperName && state.wallpaper === 'photo';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // Set up from your phone: the TV shows an address and a code; the phone page
  // (served by the app while this screen is open) takes the Govee key,
  // wallpapers and town.
  function setupOverlay() {
    return `
      <div class="setup" hidden>
        <section class="setup-card">
          <div class="setup-title">Set up from your phone</div>
          <ol class="setup-steps">
            <li>Join the same Wi-Fi as this TV.</li>
            <li>On your phone, open <strong class="tnum" data-setup-url></strong></li>
            <li>Enter the code <strong class="setup-pin tnum" data-setup-pin></strong></li>
          </ol>
          <div class="setup-status" data-setup-status></div>
          <button class="btn btn-primary" data-focus data-action="close-setup">Done</button>
        </section>
      </div>`;
  }

  function overlay() {
    return `
      <div class="overlay" hidden>
        <div class="card glass switch-card" data-switch-card>
          <div class="ring">
            <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
              <circle cx="42" cy="42" r="34" class="ring-track"/>
              <circle cx="42" cy="42" r="34" class="ring-fill" data-ring
                stroke-dasharray="${RING_C.toFixed(1)}" transform="rotate(-90 42 42)"/>
            </svg>
            <span class="ring-count tnum" data-switch-count></span>
          </div>
          <div class="switch-title">Switching to <span data-val="hdmi"></span></div>
          <div class="sub">For your ${state.games.device}. Press Back to stay here.</div>
          <button class="btn lg" data-focus data-action="cancel-switch">Stay on launcher</button>
        </div>
        <div class="input-screen" data-input-screen hidden>
          <div class="input-label">${state.games.device} on <span data-val="hdmi"></span></div>
          <div class="input-hint">
            <div>The TV is showing your ${state.games.device}.</div>
            <button class="btn lg" data-focus data-action="close-overlay">Back to launcher</button>
          </div>
        </div>
      </div>`;
  }

  // Screen fit: TVs crop or stretch app windows a little, so the size is set
  // once by eye. The border is the edge of the launcher; the dashed line is the
  // 5% safe margin all content stays inside.
  function fitOverlay() {
    return `
      <div class="fit" hidden>
        <div class="fit-frame"></div>
        <div class="fit-safe"></div>
        <div class="fit-card">
          <div class="fit-title">Fit the screen</div>
          <div class="fit-text">Press Up or Down until the white border sits just inside the edges of your TV, with all four sides visible.</div>
          <div class="fit-size tnum" data-fit-val></div>
          <div class="fit-diag small" data-fit-diag></div>
          <button class="btn btn-primary" data-focus data-action="fit-done">Done</button>
        </div>
      </div>`;
  }

  // A slider you move with the remote: focus it, then Left and Right.
  function sliderMarkup(id, label) {
    return `
      <span class="slider" data-focus data-slider="${id}" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
        <span class="slider-track"></span>
        <span class="slider-thumb"></span>
      </span>`;
  }

  // Slider positions are 0 to 100 for all three; hue is 0 to 360 underneath.
  const sliderValue = {
    hue: () => state.tint.hue / 3.6,
    warmth: () => state.tint.warmth,
    opacity: () => state.tint.opacity,
  };

  function renderSliders() {
    all('[data-slider]').forEach((el) => {
      const v = Math.round(sliderValue[el.dataset.slider]());
      el.setAttribute('aria-valuenow', String(v));
      el.querySelector('.slider-thumb').style.left = `${v}%`;
      el.classList.toggle('muted', el.dataset.slider === 'hue' && state.tint.source === 'room');
    });
    all('[data-action="tint-room"]').forEach((b) => {
      const on = state.tint.source === 'room';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function setSlider(id, value) {
    const t = state.tint;
    const v = clamp(Math.round(value), id === 'opacity' ? 10 : 0, 100);
    if (id === 'hue') {
      t.hue = v * 3.6;
      t.source = 'custom';
    } else {
      t[id] = v;
    }
    applyColors();
    renderSliders();
    saveSoon();
  }

  function nudgeSlider(id, dir) {
    setSlider(id, sliderValue[id]() + dir * 5);
  }

  function wallpaperLabel() {
    return D.wallpapers.find((w) => w.name === state.wallpaperName)?.label || 'None';
  }

  // Customize panel, after the iPadOS one: icon style, appearance, wallpaper.
  function customizeSheet() {
    const sample = APP.youtube || D.apps[0] || { name: 'App', color: '#8e8e9a', mark: 'A' };
    const opt = (action, id, label, desc, inner) => `
      <button class="opt" data-focus data-action="${action}" data-id="${id}">${inner}<span class="opt-label">${label}</span><span class="opt-desc">${desc}</span></button>`;
    const seg = (action, items) => `
      <div class="segmented">${items.map(([id, label]) => `<button class="seg" data-focus data-action="${action}" data-id="${id}">${label}</button>`).join('')}</div>`;
    return `
      <div class="sheet-scrim" hidden>
        <section class="sheet glass" role="dialog" aria-label="Customize">
          <div class="sheet-head">
            <span class="sheet-title">Customize</span>
            <button class="btn btn-primary" data-focus data-action="close-sheet">Done</button>
          </div>
          <div class="sheet-label">Icons</div>
          <div class="opts">
            ${[['default', 'Default', 'Brand colours'], ['dark', 'Dark', 'Dark glass'], ['clear', 'Clear', 'Frosted glass'], ['tinted', 'Tinted', 'Pick a colour']]
              .map(([id, label, desc]) => opt('icon-style', id, label, desc, appIcon(sample, 76, id))).join('')}
          </div>
          <div class="tint-block" data-tint-block hidden>
            <div class="sheet-row">
              <span class="sheet-label">Colour</span>
              <span class="slider-wrap">
                <button class="seg seg-pill" data-focus data-action="tint-room">Room light</button>
                ${sliderMarkup('hue', 'Colour')}
              </span>
            </div>
            <div class="sheet-row">
              <span class="sheet-label">Warmth</span>
              <span class="slider-wrap">${sliderMarkup('warmth', 'Warmth')}</span>
            </div>
            <div class="sheet-row">
              <span class="sheet-label">Opacity</span>
              <span class="slider-wrap">${sliderMarkup('opacity', 'Opacity')}</span>
            </div>
          </div>
          <div class="sheet-row">
            <span class="sheet-label">Appearance<span class="sheet-help">Auto follows the TV</span></span>
            ${seg('appearance', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']])}
          </div>
          <div class="sheet-row">
            <span class="sheet-label">Wallpaper</span>
            ${seg('wallpaper-set', [['photo', 'Photo'], ['gradient', 'Gradient'], ['lights', 'Lights']])}
          </div>
        </section>
      </div>`;
  }

  // ---------- Weather ----------
  // Open-Meteo (free, no key). Where: the town typed in Settings; else the TV's
  // own location (Android, needs the Location setting on); else an approximate
  // place from the internet connection.
  const SKY = {
    clear: ['#9fd3ff', '#3f86d9', '#1d4c9c'],
    night: ['#6a7bd1', '#2b3a8c', '#10163f'],
    partly: ['#9fd3ff', '#3f86d9', '#1d4c9c'],
    cloud: ['#b5c2d3', '#6f84a1', '#3b4a63'],
    rain: ['#8fa6bd', '#4a6480', '#222f42'],
    snow: ['#dfe9f5', '#9db6d3', '#5f7a99'],
    storm: ['#8a8fb3', '#3f4470', '#1a1c38'],
    fog: ['#c7cdd4', '#8b95a1', '#505a66'],
  };

  // WMO weather codes as Open-Meteo reports them.
  function describeWeather(code, isDay) {
    const sky = (label, iconName, key) => ({ label, icon: iconName, palette: SKY[key] });
    if (code === 0 || code === 1) return isDay ? sky(code ? 'Mostly clear' : 'Clear', 'sun', 'clear') : sky(code ? 'Mostly clear' : 'Clear', 'moon', 'night');
    if (code === 2) return sky('Partly cloudy', 'wPartly', isDay ? 'partly' : 'night');
    if (code === 3) return sky('Cloudy', 'wCloud', 'cloud');
    if (code === 45 || code === 48) return sky('Fog', 'wFog', 'fog');
    if (code >= 51 && code <= 57) return sky('Drizzle', 'wRain', 'rain');
    if (code >= 61 && code <= 67) return sky('Rain', 'wRain', 'rain');
    if (code >= 71 && code <= 77) return sky('Snow', 'wSnow', 'snow');
    if (code >= 80 && code <= 82) return sky('Showers', 'wRain', 'rain');
    if (code === 85 || code === 86) return sky('Snow showers', 'wSnow', 'snow');
    if (code >= 95) return sky('Thunderstorm', 'wStorm', 'storm');
    return sky('Cloudy', 'wCloud', 'cloud');
  }

  async function getJson(url, headers) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  let weatherAt = 0;
  let locationAsks = 0;
  async function loadWeather() {
    try {
      let place = null;
      if (state.town) {
        const g = (await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(state.town)}&count=1&language=en&format=json`)).results?.[0];
        if (!g) {
          state.weather = null;
          state.weatherNote = 'notfound';
          renderWeather();
          return;
        }
        place = { lat: g.latitude, lon: g.longitude, name: g.name };
      } else if (NATIVE) {
        // The TV asks "allow location?" the first couple of times only.
        const granted = (nativeJson('access') || {}).location === true;
        state.locationPending = false;
        if (granted || locationAsks < 2) {
          if (!granted) locationAsks++;
          const loc = nativeJson('location');
          if (loc && !loc.error) {
            place = { lat: loc.lat, lon: loc.lon, name: await placeName(loc.lat, loc.lon) };
          } else if (loc?.error === 'permission') {
            state.weatherNote = 'permission';
            state.locationPending = true; // use the internet connection's area until it's answered
          }
        } else {
          state.weatherNote = 'permission';
        }
      }
      if (!place) {
        const ip = await getJson('https://get.geojs.io/v1/ip/geo.json');
        place = { lat: Number(ip.latitude), lon: Number(ip.longitude), name: ip.city || 'Your area' };
      }
      const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2&wind_speed_unit=mph`);
      state.weather = {
        town: place.name,
        temp: Math.round(w.current.temperature_2m),
        high: Math.round(w.daily.temperature_2m_max[0]),
        low: Math.round(w.daily.temperature_2m_min[0]),
        ...describeWeather(w.current.weather_code, w.current.is_day),
        extra: weatherExtra(w),
      };
      state.weatherNote = '';
      weatherAt = Date.now();
      try { localStorage.setItem('weather', JSON.stringify({ at: weatherAt, w: state.weather })); } catch {}
    } catch {
      if (!state.weather) state.weatherNote = 'offline';
    }
    renderWeather();
  }

  // Feels like, wind, humidity and the next few hours, from the same reply.
  function weatherExtra(w) {
    try {
      const now = w.current.time;
      const i0 = Math.max(0, w.hourly.time.findIndex((t) => t > now));
      const hours = [0, 1, 2, 3, 4, 5].map((k) => {
        const i = i0 + k * 2 - 0;
        return { at: String(w.hourly.time[i]).slice(11, 16), temp: Math.round(w.hourly.temperature_2m[i]), rain: Math.round(w.hourly.precipitation_probability[i] || 0) };
      }).filter((h) => h.at.length === 5);
      return { feels: Math.round(w.current.apparent_temperature), wind: Math.round(w.current.wind_speed_10m), humidity: Math.round(w.current.relative_humidity_2m), hours };
    } catch {
      return null;
    }
  }

  async function placeName(lat, lon) {
    try {
      const r = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      return r.city || r.locality || r.principalSubdivision || 'Your location';
    } catch {
      return 'Your location';
    }
  }

  function renderWeather() {
    const w = state.weather;
    const card = stage.querySelector('[data-weather-card]');
    card.classList.toggle('is-empty', !w);
    if (!w) {
      const msg = {
        loading: ['Getting the weather', 'One moment'],
        permission: ['Allow location', 'Turn on location for this app, or add your town in Settings'],
        offline: ['Add your town', 'Set it in Settings, or turn on location'],
        notfound: ['Town not found', `Couldn't find "${state.town}". Check the spelling in Settings`],
      }[state.weatherNote] || ['Add your town', 'Set it in Settings to see the weather'];
      stage.querySelector('[data-w-empty-title]').textContent = msg[0];
      stage.querySelector('[data-w-empty-text]').textContent = msg[1];
      return;
    }
    stage.querySelector('[data-w-town]').textContent = w.town;
    stage.querySelector('[data-w-icon]').innerHTML = icon(w.icon, 40);
    stage.querySelector('[data-w-temp]').textContent = `${w.temp}°`;
    stage.querySelector('[data-w-label]').textContent = w.label;
    stage.querySelector('[data-w-range]').textContent = `High ${w.high}°, low ${w.low}°`;
    setTint(card, w.palette);
  }

  function openSetup() {
    if (!NATIVE) {
      toast('Set-up from your phone works on the TV');
      return;
    }
    const info = nativeJson('startSetup');
    if (!info || info.error) {
      toast(info?.error || 'Could not start. Check the TV is on Wi-Fi');
      return;
    }
    state.setupOpen = true;
    refs.setup.hidden = false;
    stage.querySelector('[data-setup-url]').textContent = info.url;
    stage.querySelector('[data-setup-pin]').textContent = info.pin;
    renderSetupStatus();
    refs.setup.querySelector('[data-action="close-setup"]').focus();
  }

  function closeSetup() {
    state.setupOpen = false;
    refs.setup.hidden = true;
    nativeCall('stopSetup');
    applyState();
  }

  function renderSetupStatus() {
    const g = state.govee;
    const lines = [
      g.connected ? `Govee: connected, ${g.devices.length} devices` : g.hasKey ? `Govee: ${g.error || 'connecting'}` : 'Govee: waiting for your key',
      `Wallpapers added: ${D.wallpapers.filter((w) => w.custom).length}`,
    ];
    stage.querySelector('[data-setup-status]').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  // Messages from the Android side: the phone page was used, Govee answered.
  window.onNative = (name, data) => {
    if (name === 'setup') {
      tmdbKey = nativeCall('tmdbKey') || '';
      refreshWallpapers();
      if (state.view === 'wallpapers') renderWallpapers();
      if (data?.town !== undefined) {
        state.town = data.town;
        stage.querySelector('#town-input').value = state.town;
        saveSoon();
        loadWeather();
      }
    }
    if (name === 'govee') applyGovee(data);
    if (name === 'adb') {
      state.adb = { ...(state.adb || {}), ...data };
      state.adbConfirm = false;
      if (state.view === 'cleanup') {
        renderCleanup();
        stage.querySelector('[data-action="adb-connect"]')?.focus();
      }
    }
    if (state.setupOpen) renderSetupStatus();
    applyState();
  };

  function launchApp(id) {
    const a = APP[id];
    if (!a) {
      toast('That app isn\'t installed');
      return;
    }
    noteLaunch(id);
    if (NATIVE && a.pkg) nativeCall('launch', a.pkg);
    else toast(`Opening ${a.name}`);
    renderJump();
  }

  // ---------- Govee ----------
  // The account's lights come from the Android side. The TV backlight is the
  // device that matches the model in data.js (the H6097) or is named for the TV.
  function goveeDevices() {
    return NATIVE ? state.govee.devices.filter((d) => d.light) : [];
  }

  function backlightDevice() {
    const all = goveeDevices();
    return all.find((d) => d.sku === H.backlights.model) || all.find((d) => /tv|backlight/i.test(d.name)) || null;
  }

  // The room lights: every light on the account except the TV backlight.
  // The browser preview uses the sample lights.
  function roomLights() {
    if (!NATIVE) return H.lights;
    const bl = backlightDevice();
    return goveeDevices().filter((d) => d !== bl);
  }

  function applyGovee(data) {
    if (!data) return;
    if (data.live) {
      applyLive(data.live);
      return;
    }
    state.govee = { hasKey: !!data.hasKey, connected: !!data.connected, error: data.error || '', devices: data.devices || [] };
    state.govee.devices.forEach((d) => {
      if (d.light) state.home.lights[d.id] = !!d.on;
    });
    if (data.message) toast(data.message);
    if (data.connected && !firstRead) { firstRead = true; setTimeout(readBacklight, 400); }
    renderLights();
  }

  // ---------- The backlight as it really is ----------
  // Read from Govee every so often, so a change made in the Govee app shows
  // here too: the glow and wallpaper take the light's own colour.

  function paletteFrom(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let hue = 0;
    if (d) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
    }
    const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const s = Math.max(0.35, Math.min(1, sat));
    return [hex, hslToHex((hue + 28 + 360) % 360, s, Math.max(0.35, Math.min(0.6, l))), hslToHex((hue - 28 + 360) % 360, s, 0.32)];
  }

  function kelvinHex(k) {
    return mixHex('#ff8a2a', '#fff4e8', Math.max(0, Math.min(1, (k - 2000) / 4500)));
  }

  let lastSent = 0;
  let firstRead = false;
  let livePoll = 0;

  function applyLive(l) {
    const bl = backlightDevice();
    if (!bl || l.id !== bl.id || Date.now() - lastSent < 12000) return;
    const h = state.home;
    if (l.on === false) {
      if (h.backlight !== 'off') { h.backlight = 'off'; applyState(); }
      return;
    }
    const hex = l.rgb ? rgbToHex((l.rgb >> 16) & 255, (l.rgb >> 8) & 255, l.rgb & 255) : l.kelvin ? kelvinHex(l.kelvin) : null;
    if (hex) {
      BACKLIGHT.live.colors = paletteFrom(hex);
      h.lastScene = 'live';
      if (h.backlight === 'off' || h.backlight === 'none') h.backlight = 'live';
      else if (BACKLIGHT[h.backlight] && !['sync', 'live'].includes(h.backlight)
        && hexToRgb(BACKLIGHT[h.backlight].colors[0]).some((v, i) => Math.abs(v - hexToRgb(hex)[i]) > 40)) h.backlight = 'live'; // changed in the Govee app
    } else if (h.backlight === 'off') {
      h.backlight = 'live';
    }
    applyState();
  }

  function readBacklight() {
    const bl = backlightDevice();
    if (NATIVE && bl) nativeCall('goveeRead', bl.id);
  }

  // The glow drifts around the scene's colours; with Animate on, so does the
  // backlight itself (over the local network, a small step every 1.5 seconds).
  let driftT = 0;
  function driftStep() {
    if (document.hidden) return;
    const h = state.home;
    if (!h.drift || h.backlight === 'off' || h.backlight === 'sync') return;
    const cols = BACKLIGHT[h.backlight === 'none' ? 'live' : h.backlight]?.colors || BACKLIGHT[h.lastScene].colors;
    driftT = (driftT + 1.5 / 36) % 1; // a full circuit takes 36 seconds
    const x = driftT * cols.length;
    const i = Math.floor(x);
    const hex = mixHex(cols[i % cols.length], cols[(i + 1) % cols.length], x - i);
    state.glow = hex;
    applyColors();
    const bl = backlightDevice();
    if (NATIVE && bl && bl.lan) {
      const [r, g, b] = hexToRgb(hex);
      nativeCall('goveeColor', bl.id, r, g, b);
      lastSent = Date.now();
    }
  }

  function renderLights() {
    const list = stage.querySelector('[data-light-list]');
    if (!list) return;
    const hadFocus = list.contains(document.activeElement);
    const lights = roomLights();
    list.style.setProperty('--rows', Math.max(1, Math.ceil(lights.length / 2)));
    list.innerHTML = lights.length ? lights.map((l) => `
      <button class="light-row" data-focus data-action="light" data-id="${l.id}">
        <span class="light-dot"></span><span class="light-name">${l.name}</span>
        <span class="switch" aria-hidden="true"><span></span></span>
      </button>`).join('') : `
      <button class="light-cta" data-focus data-action="open-setup">
        ${icon('phone', 24)}
        <span><span class="light-name">Connect your Govee lights</span><span class="small">${state.govee.error || 'Add your Govee key from your phone'}</span></span>
      </button>`;
    if (hadFocus) list.querySelector('[data-focus]')?.focus();
    renderRoom();
  }

  // Sends the backlight choice to the TV backlight (the local network if the
  // light answers there, otherwise Govee's cloud).
  function sendBacklight() {
    const sc = BACKLIGHT[state.home.backlight];
    if (sc && !['none', 'live'].includes(sc.id)) spreadColors(sc.colors);
    if (!NATIVE) return;
    const bl = backlightDevice();
    if (!bl) {
      toast('Connect Govee first (Settings, Set up from your phone)');
      return;
    }
    const h = state.home;
    if (h.backlight === 'off') nativeCall('goveePower', bl.id, false);
    else if (h.backlight === 'sync') nativeCall('goveeDreamView', bl.id, true);
    else {
      const [r, g, b] = hexToRgb(BACKLIGHT[h.backlight].colors[0]);
      nativeCall('goveeColor', bl.id, r, g, b);
    }
    if (h.backlight !== 'sync') lastSent = Date.now();
  }

  function applyScene(sc) {
    const rule = sc.lights;
    roomLights().forEach((l) => {
      const on = rule.on && !(rule.ceiling === false && state.roles[l.id] === 'ceiling');
      state.home.lights[l.id] = on;
      if (!NATIVE) return;
      if (!on) {
        nativeCall('goveePower', l.id, false);
        return;
      }
      if (l.white) nativeCall('goveeWhite', l.id, rule.kelvin); // also turns it on
      else nativeCall('goveePower', l.id, true);
      if (l.brightness) nativeCall('goveeBrightness', l.id, rule.brightness);
    });
    setBacklight(sc.backlight);
    state.home.scene = sc.id;
    sendBacklight();
  }

  // What's playing on the TV (YouTube Music or any app with a media session).
  // The Android side sends the cover and its colours only when the song
  // changes, so a repeat poll is a few bytes and the page isn't rebuilt.
  let pollTick = 0;
  let npKey = null;
  function pollNowPlaying() {
    const np = nativeJson('nowPlaying', npKey || '');
    const was = state.live;
    state.live = !!np;
    if (!np) {
      npKey = null;
    } else if (np.key !== npKey) {
      npKey = np.key;
      D.music.tracks = [{
        title: np.title,
        artist: np.artist || '',
        durationSec: Math.max(0, Math.round((np.durationMs || 0) / 1000)),
        art: np.art ? `center / cover no-repeat url("${np.art}")` : 'linear-gradient(140deg,#3a3a48,#121218)',
        palette: np.colors && np.colors.length === 3 ? np.colors : null,
        source: np.source || '',
        icon: np.icon || '',
        controls: np.controls !== false,
      }];
      state.track = 0;
      state.pos = Math.round((np.positionMs || 0) / 1000);
      state.playing = !!np.playing;
      renderTrack();
      applyState();
      return;
    } else {
      state.pos = Math.round((np.positionMs || 0) / 1000);
      state.playing = !!np.playing;
      updatePlayback();
      renderPlayButtons();
    }
    if (was !== state.live) applyState();
  }

  function build() {
    stage.innerHTML = `
      <div class="edge" aria-hidden="true"></div>
      <div class="shade" aria-hidden="true"></div>
      <div class="aurora" aria-hidden="true"><i></i><i></i></div>

      <header class="topbar">
        <div class="status">
          <span class="status-time tnum" data-clock></span>
          <span class="status-date" data-date></span>
        </div>
        <nav class="tabbar glass" aria-label="Main">
          ${D.nav.map((n) => `
            <button class="tab" data-focus data-nav="${n.id}" aria-label="${n.label}">${icon(n.id, 22)}</button>`).join('')}
        </nav>
        <div class="tools">
          <span class="status-wifi" title="Wi-Fi connected">${icon('wifi', 18)}</span>
          <button class="tool" data-focus data-action="match-lights" aria-label="Match wallpaper to backlights">${icon('drop', 20)}</button>
          <button class="tool" data-focus data-action="customize" aria-label="Customize">${icon('sun', 20)}</button>
          <button class="tool" data-focus data-nav="settings" aria-label="Settings">${icon('gear', 20)}</button>
        </div>
      </header>

      <div class="views">
        ${homeView()}${searchView()}${musicView()}${appsView()}${gamesView()}${roomView()}${settingsView()}${wallpapersView()}${cleanupView()}${rolesView()}${guestView()}
      </div>

      ${overlay()}
      ${customizeSheet()}
      ${fitOverlay()}
      ${setupOverlay()}
      <div class="xscrim" hidden><section class="xpanel" role="dialog" aria-modal="true" data-xpanel></section></div>
      <div class="ambient" hidden aria-hidden="true"><div class="amb-a"></div><div class="amb-b"></div><div class="amb-info"><div class="amb-clock" data-amb-clock></div><div class="amb-sub" data-amb-sub></div></div></div>
      <div class="toast glass" role="status" hidden></div>
    `;

    refs = {
      clock: stage.querySelector('[data-clock]'),
      date: stage.querySelector('[data-date]'),
      sheet: stage.querySelector('.sheet-scrim'),
      fit: stage.querySelector('.fit'),
      setup: stage.querySelector('.setup'),
      searchInput: stage.querySelector('#search-input'),
      townInput: stage.querySelector('#town-input'),
      overlay: stage.querySelector('.overlay'),
      x: stage.querySelector('.xscrim'),
      xpanel: stage.querySelector('[data-xpanel]'),
      switchCard: stage.querySelector('[data-switch-card]'),
      inputScreen: stage.querySelector('[data-input-screen]'),
      ring: stage.querySelector('[data-ring]'),
      count: stage.querySelector('[data-switch-count]'),
      toast: stage.querySelector('.toast'),
    };

    refs.townInput.value = state.town;
    showPhoto();
    applyState();
    renderTrack();
    renderJump();
    renderSearch();
    renderLights();
    updateClock();
  }

  let refs = {};
  const all = (sel) => stage.querySelectorAll(sel);

  // ---------- State to DOM ----------

  function applyState() {
    state.theme = state.appearance === 'auto' ? initialTheme() : state.appearance;
    const dark = state.theme === 'dark';
    const photo = state.wallpaper === 'photo';
    const g = state.games;

    stage.classList.toggle('light', !dark);
    stage.classList.toggle('photo', photo);
    stage.classList.toggle('animate', !!state.home.drift);
    stage.classList.toggle('fast', state.motion === 'fast');
    all('[data-set-menu]').forEach((el) => { el.hidden = !!state.settingsCat; });
    all('[data-set-cat]').forEach((el) => { el.hidden = el.dataset.setCat !== state.settingsCat; });
    applyColors();
    all('[data-theme-icon]').forEach((el) => { el.innerHTML = icon(dark ? 'moon' : 'sun'); });

    // Icon style: restyle every app icon except the fixed samples in Customize.
    iconStyle = state.iconStyle;
    all('.app-ic').forEach((el) => {
      if (el.closest('.opts')) return;
      el.className = el.className.replace(/\bs-\w+/, `s-${state.iconStyle}`);
    });
    const pressed = (sel, on) => all(sel).forEach((b) => {
      const isOn = on(b.dataset.id);
      b.classList.toggle('on', isOn);
      b.setAttribute('aria-pressed', String(isOn));
    });
    const wp = state.matchLights ? 'lights' : state.wallpaper;
    pressed('[data-action="icon-style"]', (id) => id === state.iconStyle);
    stage.querySelector('[data-tint-block]').hidden = state.iconStyle !== 'tinted';
    renderSliders();
    pressed('[data-action="appearance"]', (id) => id === state.appearance);
    pressed('[data-action="wallpaper-set"]', (id) => id === wp);

    renderPlayButtons();

    all('[data-np-card]').forEach((c) => c.classList.toggle('paused', !state.playing));

    all('[data-nav]').forEach((b) => {
      const on = b.dataset.nav === state.view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    all('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== state.view; });

    const access = (NATIVE && nativeJson('access')) || {};
    const values = {
      theme: { auto: `Auto (${dark ? 'dark' : 'light'})`, light: 'Light', dark: 'Dark' }[state.appearance],
      wallpaper: { lights: 'Matches lights', photo: 'Photo', gradient: 'Gradient' }[wp],
      hdmi: `HDMI ${g.hdmiPort}`,
      auto: g.autoSwitch ? 'On' : 'Off',
      countdown: g.countdownSec ? `${g.countdownSec} s` : 'None',
      wifi: 'Connected',
      match: state.matchLights ? 'On' : 'Off',
      drift: state.home.drift ? 'On' : 'Off',
      sample: state.sampleData ? 'On' : 'Off',
      wp: wallpaperLabel(),
      ambient: state.ambient ? `After ${state.ambient} min` : 'Off',
      motion: state.motion === 'fast' ? 'Fast' : 'Smooth',
      wn: state.wnCheck || 'Press OK',
      speed: state.speed || 'Press OK',
      guest: NATIVE ? (guestInfo().ssid || 'Add from your phone') : 'Sample',
      spread: state.spread ? 'On' : 'Off',
      setup: NATIVE ? 'Press OK' : 'On the TV',
      cleanup: cleanupItems().length ? `${cleanupItems().length} chosen` : 'Nothing yet',
      govee: !NATIVE ? 'On the TV'
        : state.govee.connected ? `Connected, ${state.govee.devices.length} devices`
          : state.govee.hasKey ? (state.govee.error || 'Connecting') : 'Not connected',
      roles: `${Object.keys(state.roles).length} set`,
      home: !NATIVE ? 'On the TV' : state.homeDefault ? 'This launcher' : 'Google TV. Press OK',
      fit: `${Math.round((userFit || 1) * 100)}%`,
      'np-access': access.nowPlaying ? 'Allowed' : 'Off. Press OK to allow',
      'usage-access': access.recentApps ? 'Allowed' : 'Off. Press OK to allow',
    };
    all('[data-val]').forEach((el) => { el.textContent = values[el.dataset.val]; });
    all('.tog').forEach((el) => el.classList.toggle('on', el.querySelector('[data-val]').textContent === 'On'));
    renderWeather();

    renderRoom();

    // Empty states: what Home shows when there's no data to fill a widget.
    const sample = state.sampleData && !NATIVE;
    stage.querySelector('.w-music').classList.toggle('is-empty', NATIVE ? !state.live : !sample);
    if (NATIVE) {
      const noAccess = !access.nowPlaying;
      all('[data-np-empty-title]').forEach((el) => { el.textContent = noAccess ? 'Show what is playing' : 'Nothing playing'; });
      all('[data-np-empty-text]').forEach((el) => {
        el.textContent = noAccess
          ? 'Let the launcher see what plays on the TV, including casts from your phone.'
          : 'Music from any app, or cast from your phone, shows up here.';
      });
      all('[data-np-allow]').forEach((el) => { el.hidden = !noAccess; });
      all('[data-np-open]').forEach((el) => { el.hidden = noAccess || !APP.ytmusic; });
      // The Music tab shows only what's really playing; the sample mixes are for the preview.
      stage.querySelector('[data-music-empty]').hidden = state.live;
      stage.querySelector('.music-grid').hidden = !state.live;
      stage.querySelector('.music-mixes').hidden = true;
    }
    stage.querySelector('.w-hero').classList.toggle('is-empty', NATIVE ? !state.cw.length : !sample);
    stage.querySelector('.w-music .np-next').hidden = !!NATIVE;
    all('[data-cw]').forEach((el) => { el.hidden = NATIVE ? Number(el.dataset.i) >= state.cw.length - 1 : !sample; });
    all('[data-scenes]').forEach((el) => { el.hidden = NATIVE ? state.cw.length >= 3 : sample; });
    all('[data-recent]').forEach((el) => { el.hidden = sample || (NATIVE && state.cw.length > 1); });

    stage.querySelector('[data-games-sub]').textContent = g.autoSwitch
      ? `Opening Games switches the TV to HDMI ${g.hdmiPort}${g.countdownSec ? ` after a ${g.countdownSec} second countdown` : ' straight away'}.`
      : 'Auto-switch is off. Opening Games stays on the launcher.';
  }

  // Card colours from the album art. The prototype's art is a CSS gradient, so
  // its colour stops are the palette. On device: androidx.palette Palette.from(bitmap)
  // (vibrant, muted and dark-muted swatches).
  function artPalette(art) {
    const stops = art.match(/#[0-9a-f]{6}/gi) || ['#3a3a48', '#24242e', '#121218'];
    return [stops[0], stops[Math.floor(stops.length / 2)], stops[stops.length - 1]];
  }

  function setTint(el, [light, mid, dark]) {
    el.style.setProperty('--t0', light);
    el.style.setProperty('--t0a', toHex(light) ? withAlpha(toHex(light), 0.75) : light);
    el.style.setProperty('--t1', mid);
    el.style.setProperty('--t2', dark);
  }

  function renderRoom() {
    const h = state.home;
    const colors = BACKLIGHT[h.lastScene].colors;
    const press = (sel, isOn) => all(sel).forEach((b) => {
      const on = isOn(b.dataset.id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    // Backlight bleed: the screen edges glow in the light colour. In "Sync to
    // TV" mode the focused item's colour takes over (see syncGlow below).
    if ((h.backlight !== 'sync' || NATIVE) && !h.drift) state.glow = null;
    applyColors();
    stage.querySelector('.edge').classList.toggle('off', h.backlight === 'off');
    stage.classList.toggle('lights', state.matchLights && h.backlight !== 'off');
    const matchBtn = stage.querySelector('.tool[data-action="match-lights"]');
    matchBtn.classList.toggle('on', state.matchLights);
    matchBtn.style.color = state.matchLights ? colors[0] : '';

    press('[data-action="backlight"]', (id) => id === h.backlight);
    press('[data-action="room-scene"]', (id) => id === h.scene);
    press('[data-action="light"]', (id) => h.lights[id]);

    const roomList = roomLights();
    const lightsOn = roomList.filter((l) => h.lights[l.id]).length;
    const swatch = stage.querySelector('[data-room-swatch]');
    swatch.style.background = h.backlight === 'off' ? 'var(--track)' : `linear-gradient(135deg, ${colors.join(',')})`;
    stage.querySelector('[data-room-scene]').textContent = h.backlight === 'off'
      ? 'Backlight off' : h.backlight === 'sync' ? 'Synced to TV' : BACKLIGHT[h.backlight].name;
    if (NATIVE) state.sleepAt = Number(nativeCall('goveeSleepAt')) || 0;
    const sl = stage.querySelector('[data-sleep-label]');
    if (sl) sl.textContent = state.sleepAt > Date.now() ? `Lights off in ${Math.max(1, Math.round((state.sleepAt - Date.now()) / 60000))} min` : 'Sleep timer: Off';
    stage.querySelector('[data-room-lights]').textContent = roomList.length ? `${lightsOn} of ${roomList.length} lights on` : 'Add your lights';
    stage.querySelector('[data-room-sound]').textContent = !h.sound.on ? 'Soundbar off'
      : h.sound.muted ? 'Soundbar muted' : `Volume ${h.sound.volume}`;

    stage.querySelector('[data-backlight-status]').textContent = h.backlight === 'sync'
      ? 'Synced to the TV picture'
      : h.backlight === 'off' ? 'Off' : BACKLIGHT[h.backlight].name;

    const sb = h.sound;
    stage.querySelector('[data-vol-fill]').style.width = `${sb.muted ? 0 : (sb.volume / sb.max) * 100}%`;
    stage.querySelector('[data-vol]').textContent = sb.muted ? 'Muted' : sb.volume;
    stage.querySelector('[data-sound-status]').textContent = (NATIVE ? 'Follows the TV volume' : sb.on ? 'On' : 'Standby');
    stage.querySelector('.soundbar').classList.toggle('standby', !sb.on);
  }

  function setBacklight(id) {
    const h = state.home;
    h.backlight = id;
    if (BACKLIGHT[id]) h.lastScene = id;
  }

  function renderTrack() {
    const t = track();
    all('[data-np-art]').forEach((el) => { el.style.background = t.art; });
    all('[data-np-card]').forEach((el) => setTint(el, t.palette || artPalette(t.art)));
    all('[data-np-title]').forEach((el) => { el.textContent = t.title; });
    const src = t.icon ? { color: '#8e8e9a', mark: (t.source || '?').slice(0, 1), iconUrl: t.icon, name: t.source } : APP.ytmusic;
    all('[data-np-src-icon]').forEach((el) => { el.innerHTML = src ? appIcon(src, Number(el.dataset.npSrcIcon)) : ''; });
    all('[data-np-source]').forEach((el) => { el.textContent = t.source || D.music.source; });
    all('[data-np-card]').forEach((el) => el.classList.toggle('no-controls', t.controls === false));
    all('[data-np-artist]').forEach((el) => { el.textContent = t.artist; });
    all('[data-duration]').forEach((el) => { el.textContent = t.durationSec > 0 ? fmt(t.durationSec) : ''; });

    const tracks = D.music.tracks;
    stage.querySelector('[data-np-next]').innerHTML = [1].map((k) => {
      const q = tracks[(state.track + k) % tracks.length];
      return `
        <div class="np-next-row">
          <span class="np-next-art" style="background:${q.art}"></span>
          <span class="np-next-text"><span class="np-next-title">${q.title}</span><span class="small">${q.artist}</span></span>
        </div>`;
    }).join('');

    const queue = stage.querySelector('[data-queue]');
    if (NATIVE) {
      queue.innerHTML = '<div class="small">The app playing doesn\'t share its queue.</div>';
      updatePlayback();
      return;
    }
    const hadFocus = queue.contains(document.activeElement);
    queue.innerHTML = [1, 2, 3, 4].map((k) => {
      const i = (state.track + k) % tracks.length;
      const q = tracks[i];
      return `
        <button class="queue-row" data-focus data-track="${i}" aria-label="Play ${q.title} by ${q.artist}">
          <span class="queue-art" style="background:${q.art}"></span>
          <span class="queue-text"><span class="queue-title">${q.title}</span><span class="small">${q.artist}</span></span>
          <span class="small tnum">${fmt(q.durationSec)}</span>
        </button>`;
    }).join('');
    if (hadFocus) queue.querySelector('button').focus();

    updatePlayback();
  }

  function renderPlayButtons() {
    all('[data-action="play"]').forEach((b) => {
      if (b.dataset.playing === String(state.playing)) return;
      b.dataset.playing = String(state.playing);
      b.innerHTML = state.playing ? filledIcon('pause') : filledIcon('play');
      b.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    });
  }

  function updatePlayback() {
    const dur = track().durationSec;
    all('[data-progress]').forEach((el) => { el.style.width = dur > 0 ? `${Math.min(100, (state.pos / dur) * 100)}%` : '0%'; });
    all('[data-elapsed]').forEach((el) => { el.textContent = dur > 0 ? fmt(state.pos) : ''; });
  }

  function setTrack(i) {
    const n = D.music.tracks.length;
    state.track = ((i % n) + n) % n;
    state.pos = 0;
    renderTrack();
  }

  // On the TV, only real things are listed: the apps installed. Titles and
  // prices come from Google TV's own search.
  function renderTvSearch(q) {
    const list = D.apps.filter((a) => !q || a.name.toLowerCase().includes(q));
    const el = stage.querySelector('[data-shows="apps"]');
    el.innerHTML = list.slice(0, 10).map((a) => appTile(a, 'app-card glass', 68)).join('');
    if (!list.length) el.innerHTML = tmdbReady() ? '' : `<div class="empty small">No app called “${state.query.trim()}”. Try Search with Google TV.</div>`;
    stage.querySelector('[data-search-count]').textContent = q ? `${list.length} app${list.length === 1 ? '' : 's'}` : '';
    const hint = stage.querySelector('[data-search-hint]');
    if (hint) {
      hint.innerHTML = tmdbReady()
        ? 'Show data from TMDB; where to watch from JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB.'
        : 'To search shows and films here, add a TMDB key on the phone setup page. Search with Google TV also works.';
    }
  }

  function renderSearch() {
    const q = state.query.trim().toLowerCase();
    if (NATIVE) return renderTvSearch(q);
    const results = D.catalogue.filter((s) => APP[s.app] && (!q
      || s.title.toLowerCase().includes(q)
      || s.meta.toLowerCase().includes(q)
      || APP[s.app].name.toLowerCase().includes(q)));
    const free = results.filter((s) => s.offer.kind === 'free' || s.offer.kind === 'subscription');
    const paid = results.filter((s) => s.offer.kind === 'rent' || s.offer.kind === 'buy');

    const fill = (key, list, emptyText) => {
      const el = stage.querySelector(`[data-shows="${key}"]`);
      el.innerHTML = list.map(showCard).join('');
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'empty small';
        empty.textContent = emptyText;
        el.append(empty);
      }
    };
    fill('free', free, q ? `Nothing free on your apps matches “${state.query.trim()}”` : 'Nothing free right now');
    fill('paid', paid, q ? `Nothing to rent or buy matches “${state.query.trim()}”` : 'Nothing to rent or buy');

    stage.querySelector('[data-search-count]').textContent = q
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : 'Suggested for you';
  }

  function updateClock() {
    const n = new Date();
    const time = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
    if (refs.clock.textContent === time) return;
    refs.clock.textContent = time;
    refs.date.textContent = n.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Built-in wallpapers plus photos added from a phone (app storage).
  function refreshWallpapers() {
    const builtin = D.wallpaperFiles.map(([file, label]) => ({ name: file, label, url: `${D.wallpaperBase}${file}`, custom: false }));
    const added = (NATIVE ? nativeJson('wallpapers') || [] : []).map((w) => ({ name: `added:${w.name}`, label: 'Added from phone', url: w.url, custom: true }));
    D.wallpapers = [...builtin, ...added];
    if (!D.wallpapers.some((w) => w.name === state.wallpaperName)) state.wallpaperName = D.wallpapers[0]?.name || null;
  }

  function showPhoto() {
    const w = D.wallpapers.find((x) => x.name === state.wallpaperName);
    if (!w) return;
    stage.style.setProperty('--photo', `url("${w.url}")`);
    makeFrost(w.url);
  }

  // The glass panels show a pre-blurred copy of the wallpaper instead of
  // blurring what's behind them every frame (that was the slow part). A tiny
  // canvas does the blur once per photo. Panels pin it to the screen, see
  // "v5" in styles.css.
  function makeFrost(url) {
    const img = new Image();
    img.onload = () => {
      try {
        const margin = 8; // keeps the blur from fading out at the edges
        const c = document.createElement('canvas');
        c.width = 192;
        c.height = 108;
        const g = c.getContext('2d');
        const tw = c.width + margin * 2;
        const th = c.height + margin * 2;
        const k = Math.max(tw / img.width, th / img.height);
        if ('filter' in g) g.filter = 'blur(2px)';
        g.drawImage(img, (tw - img.width * k) / 2 - margin, (th - img.height * k) / 2 - margin, img.width * k, img.height * k);
        stage.style.setProperty('--frost', `url(${c.toDataURL('image/jpeg', 0.85)})`);
      } catch {
        // Canvas blocked (previewing from a local file): use the photo as it is.
        stage.style.setProperty('--frost', `url("${url}")`);
      }
    };
    img.src = url;
  }

  let toastTimer;
  function toast(text) {
    refs.toast.textContent = text;
    refs.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { refs.toast.hidden = true; }, 2200);
  }

  // ---------- Views and Games switching ----------

  function setWallpaper(id) {
    state.matchLights = id === 'lights';
    if (id !== 'lights') state.wallpaper = id;
  }

  function openSheet() {
    refs.sheet.hidden = false;
    (refs.sheet.querySelector('.opt.on') || refs.sheet.querySelector('[data-focus]')).focus();
  }

  function closeSheet() {
    refs.sheet.hidden = true;
    stage.querySelector('.tool[data-action="customize"]').focus();
  }

  // Blocks that animate in when a view opens, staggered in reading order.
  const ANIM_SELECTOR = ':is(.widgets > *, .dock, .search-bar, .search-section, '
    + '.music-grid > *, .music-mixes, .app-card, '
    + '.games-hero, .info, .settings, .room-grid > *, .soundbar)';

  function animateView(id) {
    const view = stage.querySelector(`[data-view="${id}"]`);
    view.querySelectorAll(ANIM_SELECTOR).forEach((el, i) => {
      el.classList.remove('anim');
      el.style.setProperty('--d', `${Math.min(i * 45, 400)}ms`);
    });
    view.offsetWidth; // restart the animation on views opened before
    view.querySelectorAll(ANIM_SELECTOR).forEach((el) => el.classList.add('anim'));
  }

  function openView(id) {
    if (state.view === 'wallpapers' && id !== 'wallpapers') stage.querySelector('[data-wp-grid]').innerHTML = '';
    state.view = id;
    applyState();
    if (id === 'wallpapers') renderWallpapers();
    if (id === 'cleanup') renderCleanup();
    if (id === 'roles') renderRoles();
    if (id === 'guest') renderGuest();
    animateView(id);
    alignFrost(100);
    setTimeout(() => alignFrost(0), 900); // again once the entry animation has settled
    if (id === 'games' && state.games.autoSwitch) startSwitch();
  }

  let switchTimer;
  function startSwitch() {
    const g = state.games;
    clearInterval(switchTimer);
    refs.overlay.hidden = false;
    if (!g.countdownSec) {
      showInputScreen();
      return;
    }

    let remaining = g.countdownSec;
    refs.switchCard.hidden = false;
    refs.inputScreen.hidden = true;
    refs.count.textContent = remaining;

    // One continuous sweep of the ring over the whole countdown.
    refs.ring.style.transition = 'none';
    refs.ring.style.strokeDashoffset = '0';
    refs.ring.getBoundingClientRect();
    refs.ring.style.transition = `stroke-dashoffset ${remaining}s linear`;
    refs.ring.style.strokeDashoffset = String(RING_C);

    stage.querySelector('[data-action="cancel-switch"]').focus();
    switchTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(switchTimer);
        showInputScreen();
      } else {
        refs.count.textContent = remaining;
      }
    }, 1000);
  }

  // On the TV this switches input for real; in the browser a stand-in screen
  // shows what would happen.
  // Gaming mode: the lights change when the TV switches to the console and
  // come back, as they were, when you return to the launcher.
  let gameSnap = null;
  function enterGaming() {
    if (gameSnap || !roomLights().length) return;
    gameSnap = { lights: { ...state.home.lights }, backlight: state.home.backlight, scene: state.home.scene };
    applyScene(ROOM_SCENE.gaming);
    applyState();
  }

  function leaveGaming() {
    if (!gameSnap) return;
    const snap = gameSnap;
    gameSnap = null;
    roomLights().forEach((l) => {
      state.home.lights[l.id] = !!snap.lights[l.id];
      nativeCall('goveePower', l.id, !!snap.lights[l.id]);
    });
    setBacklight(snap.backlight);
    state.home.scene = snap.scene;
    sendBacklight();
    applyState();
    toast('Lights back to how they were');
  }

  function showInputScreen() {
    enterGaming();
    if (NATIVE) {
      const ok = nativeCall('switchToHdmi', state.games.hdmiPort);
      closeOverlay();
      if (!ok) toast(`Couldn't find HDMI ${state.games.hdmiPort} on this TV`);
      return;
    }
    refs.switchCard.hidden = true;
    refs.inputScreen.hidden = false;
    stage.querySelector('[data-action="close-overlay"]').focus();
  }

  function closeOverlay() {
    clearInterval(switchTimer);
    refs.overlay.hidden = true;
    stage.querySelector('[data-action="switch-now"]').focus();
  }

  // ---------- Input ----------

  stage.addEventListener('click', (e) => {
    const card = e.target.closest('[data-expand]');
    const inner = e.target.closest('button');
    if (card && (!inner || inner === card) && refs.x.hidden) {
      if (card.dataset.expand === 'weather' && !state.weather && card.querySelector('.w-empty')) openView('settings');
      else openExpand(card);
      return;
    }
    if (e.target === refs.x) { closeExpand(); return; }
    const b = inner;
    if (!b) return;
    const g = state.games;
    const act = b.dataset.action;

    if (b.dataset.wn !== undefined && NATIVE) {
      const it = state.cw[Number(b.dataset.wn)];
      if (it) { nativeCall('watchNextOpen', it.uri, it.pkg); return; }
    }
    if (b.dataset.action === 'x-close') { closeExpand(); return; }
    if ((b.dataset.nav || b.dataset.navTo) && !refs.x.hidden) { refs.x.hidden = true; refs.xpanel.innerHTML = ''; xFrom = null; }
    if (b.dataset.nav === 'settings') state.settingsCat = null;
    if (b.dataset.nav) openView(b.dataset.nav);
    else if (b.dataset.navTo) openView(b.dataset.navTo);
    else if (b.dataset.app) launchApp(b.dataset.app);
    else if (b.dataset.track) setTrack(Number(b.dataset.track));
    else if (b.dataset.toast) toast(b.dataset.toast);
    else if (act === 'theme') state.appearance = { auto: 'light', light: 'dark', dark: 'auto' }[state.appearance];
    else if (act === 'customize') openSheet();
    else if (act === 'toggle-sample') state.sampleData = !state.sampleData;
    else if (act === 'screen-fit') openFit();
    else if (act === 'open-wallpapers') {
      if (!refs.sheet.hidden) closeSheet();
      openView('wallpapers');
    } else if (act === 'pick-wallpaper') {
      state.wallpaperName = b.dataset.id;
      state.wallpaper = 'photo';
      state.matchLights = false;
      showPhoto();
      markWallpaper();
      toast(`Wallpaper: ${wallpaperLabel()}`);
    } else if (act === 'open-setup') openSetup();
    else if (act === 'open-cleanup') openView('cleanup');
    else if (act === 'open-app-info') nativeCall('openAppInfo', b.dataset.pkg);
    else if (act === 'close-setup') closeSetup();
    else if (act === 'wn-check') {
      const r = nativeJson('watchNext');
      if (!r) state.wnCheck = "Couldn't check";
      else if (!r.ok) state.wnCheck = r.error === 'permission' ? 'Android blocks this launcher' : `Error: ${r.error}`;
      else if (!(r.items || []).length) state.wnCheck = 'Allowed, but your apps have shared nothing';
      else state.wnCheck = `${r.items.length} shared by ${[...new Set(r.items.map((i) => (appByPkg(i.pkg) || {}).name || i.pkg))].join(', ')}`;
      toast(state.wnCheck);
      applyState();
    } else if (act === 'cycle-motion') {
      state.motion = state.motion === 'fast' ? 'smooth' : 'fast';
    } else if (act === 'speed-test') {
      runSpeedTest();
    } else if (act === 'settings-cat') {
      state.settingsCat = b.dataset.cat;
      applyState();
      stage.querySelector(`[data-set-cat="${state.settingsCat}"] [data-focus]`)?.focus();
    } else if (act === 'adb-disable') {
      if (!state.adbConfirm) {
        state.adbConfirm = true;
        renderCleanup();
        stage.querySelector('[data-action="adb-disable"]')?.focus();
      } else {
        state.adbConfirm = false;
        nativeCall('adbDisable');
      }
    } else if (act === 'adb-restore') {
      nativeCall('adbRestore');
    } else if (act === 'adb-connect') {
      state.adb = { state: 'connecting' };
      renderCleanup();
      stage.querySelector('[data-action="adb-connect"]')?.focus();
      nativeCall('adbConnect');
    } else if (act === 'home-role') {
      if (NATIVE) toast(nativeCall('requestDefaultHome') === 'started' ? 'Choose Smart TV Launcher on the next screen' : 'This TV does not offer that choice. Ask me for the other way');
      else toast('Works on the TV');
    }
    else if (act === 'fit-done') closeFit();
    else if (act === 'grant-np') nativeCall('openSettings', 'notification-access');
    else if (act === 'grant-usage') nativeCall('openSettings', 'usage-access');
    else if (act === 'close-sheet') closeSheet();
    else if (act === 'icon-style') state.iconStyle = b.dataset.id;
    else if (act === 'tint-room') {
      state.tint.source = 'room';
      applyColors();
    }
    else if (act === 'appearance') state.appearance = b.dataset.id;
    else if (act === 'wallpaper-set') setWallpaper(b.dataset.id);
    else if (act === 'wallpaper') {
      const cur = state.matchLights ? 'lights' : state.wallpaper;
      setWallpaper({ photo: 'gradient', gradient: 'lights', lights: 'photo' }[cur]);
    } else if (act === 'drift') {
      const bl = backlightDevice();
      if (NATIVE && bl && !bl.lan) {
        toast('Turn on LAN Control for the backlight in the Govee Home app to animate it');
      } else {
        state.home.drift = !state.home.drift;
        if (!state.home.drift) state.glow = null;
        toast(state.home.drift ? 'Backlight drifting through its colours' : 'Animation off');
      }
    } else if (act === 'match-lights') {
      state.matchLights = !state.matchLights;
      toast(state.matchLights ? 'Wallpaper now matches your backlights' : 'Wallpaper back to your own');
    } else if (act === 'backlight') {
      setBacklight(b.dataset.id);
      state.home.scene = null;
      const id = b.dataset.id;
      toast(`TV backlight: ${id === 'sync' ? 'matching the picture' : id === 'off' ? 'off' : BACKLIGHT[id].name}`);
      sendBacklight();
    } else if (act === 'open-roles') {
      state.rolesFrom = state.view;
      openView('roles');
    } else if (act === 'cycle-role') {
      const cur = ROLES.findIndex((r) => r.id === (state.roles[b.dataset.id] || ''));
      const next = ROLES[(cur + 1) % ROLES.length].id;
      if (next) state.roles[b.dataset.id] = next;
      else delete state.roles[b.dataset.id];
      renderRoles();
      stage.querySelector(`[data-action="cycle-role"][data-id="${b.dataset.id}"]`)?.focus();
    } else if (act === 'spread') {
      state.spread = !state.spread;
      toast(state.spread ? 'Scenes now colour your other lights too' : 'Scenes colour only the backlight');
    } else if (act === 'open-guest') {
      openView('guest');
    } else if (act === 'cycle-ambient') {
      const steps = [0, 5, 10, 20];
      state.ambient = steps[(steps.indexOf(state.ambient) + 1) % steps.length];
    } else if (act === 'sleep') {
      const steps = [0, 15, 30, 60];
      const left = state.sleepAt ? Math.round((state.sleepAt - Date.now()) / 60000) : 0;
      const cur = left > 45 ? 60 : left > 20 ? 30 : left > 0 ? 15 : 0;
      const min = steps[(steps.indexOf(cur) + 1) % steps.length];
      state.sleepAt = min ? Date.now() + min * 60000 : 0;
      nativeCall('goveeSleep', min);
      toast(min ? `Lights will go off in ${min} minutes` : 'Sleep timer off');
    } else if (act === 'room-scene') {
      const sc = ROOM_SCENE[b.dataset.id];
      applyScene(sc);
      toast(`${sc.name} scene`);
    } else if (act === 'light') {
      const id = b.dataset.id;
      state.home.lights[id] = !state.home.lights[id];
      state.home.scene = null;
      if (NATIVE) nativeCall('goveePower', id, state.home.lights[id]);
    } else if (act === 'vol-up' || act === 'vol-down') {
      // TV volume; over HDMI ARC the TV passes it on to the soundbar.
      const sb = state.home.sound;
      sb.muted = false;
      sb.volume = Math.max(0, Math.min(sb.max, sb.volume + (act === 'vol-up' ? 1 : -1)));
      nativeCall('volume', act === 'vol-up' ? 1 : -1);
      setTimeout(syncVolume, 250);
    } else if (act === 'mute') {
      state.home.sound.muted = !state.home.sound.muted;
      nativeCall('toggleMute');
      setTimeout(syncVolume, 250);
    }
    else if (NATIVE && state.live && ['play', 'prev', 'next'].includes(act)) {
      nativeCall('media', act === 'play' ? (state.playing ? 'pause' : 'play') : act);
      setTimeout(pollNowPlaying, 400);
    }
    else if (act === 'play') state.playing = !state.playing;
    else if (act === 'prev') {
      if (state.pos > 3) state.pos = 0;
      else setTrack(state.track - 1);
    }
    else if (act === 'next') setTrack(state.track + 1);
    else if (act === 'google-search') {
      if (NATIVE) nativeCall('googleSearch', state.query.trim());
      else toast('Opens Google TV search');
    }
    else if (act === 'switch-now') startSwitch();
    else if (act === 'cancel-switch' || act === 'close-overlay') closeOverlay();
    else if (act === 'toggle-auto') g.autoSwitch = !g.autoSwitch;
    else if (act === 'cycle-hdmi') g.hdmiPort = (g.hdmiPort % 4) + 1;
    else if (act === 'cycle-countdown') g.countdownSec = COUNTDOWN_STEPS[(COUNTDOWN_STEPS.indexOf(g.countdownSec) + 1) % COUNTDOWN_STEPS.length];
    else if (act === 'wifi') {
      if (state.view === 'settings') {
        if (NATIVE) nativeCall('openSettings', 'wifi');
        else toast('Opens Android Wi-Fi settings on the TV');
      }
      else openView('settings');
    }

    applyState();
    updatePlayback();
    saveSoon();
  });

  // Mouse or touch on a slider (the remote uses Left and Right instead).
  stage.addEventListener('click', (e) => {
    const sl = e.target.closest('[data-slider]');
    if (!sl) return;
    const r = sl.getBoundingClientRect();
    setSlider(sl.dataset.slider, ((e.clientX - r.left) / r.width) * 100);
  });

  let townTimer;
  stage.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
      state.query = e.target.value;
      renderSearch();
      if (NATIVE) queueTmdb(state.query.trim());
    } else if (e.target.id === 'town-input') {
      state.town = e.target.value.trim();
      applyState();
      clearTimeout(townTimer);
      townTimer = setTimeout(loadWeather, 900);
    }
  });

  // "Sync to TV": like the backlight's camera, take the colour of what's on
  // screen, here the artwork or brand colour of the focused item.
  function syncGlow(target) {
    const host = target.closest('.w-hero, .w-mini, .show, .mix, .now-playing, .music-now, .dock-app, .app-card') || target;
    const styled = [host, ...host.querySelectorAll('[style]')].find((el) => /#[0-9a-f]{6}|rgb\(/i.test(el.getAttribute('style') || ''));
    const tone = styled && (styled.getAttribute('style').match(/#[0-9a-f]{6}|rgb\([^)]*\)/i) || [])[0];
    const hex = toHex(tone);
    if (hex) {
      state.glow = hex;
      applyColors();
    }
  }

  // The stage itself must never scroll (focus can try to), or the glow layers slide away.
  stage.addEventListener('scroll', () => { stage.scrollTop = 0; stage.scrollLeft = 0; });

  // Remember where focus was in each view, so coming back from the sidebar
  // lands where you left off.
  const lastFocus = {};
  stage.addEventListener('focusin', (e) => {
    stage.querySelector('.search-bar')?.classList.toggle('typing', e.target.id === 'search-input');
    const view = e.target.closest('[data-view]');
    if (view) lastFocus[view.dataset.view] = e.target;
    stage.querySelector('.dock')?.classList.toggle('active', !!e.target.closest('.dock'));
    if (state.home.backlight === 'sync' && !NATIVE) syncGlow(e.target);
  });

  const KEY_DIRECTION = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };
  const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack']);

  const visible = (el) => el.getClientRects().length > 0;

  function focusables(scope) {
    return [...scope.querySelectorAll('[data-focus]')].filter(visible);
  }

  function centre(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // D-pad: move to the nearest focusable control in that direction. Distances
  // are measured between edges, so a wide row directly below counts as close
  // even when its centre is off to one side.
  function nearest(cur, dir, candidates) {
    const a = cur.getBoundingClientRect();
    const c = centre(cur);
    const gap = (lo1, hi1, lo2, hi2) => Math.max(0, lo2 - hi1, lo1 - hi2);
    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const p = centre(el);
      const dx = p.x - c.x;
      const dy = p.y - c.y;

      let primary;
      let secondary;
      switch (dir) {
        case 'left':
          if (p.x >= a.left) continue;
          primary = Math.max(0, a.left - r.right);
          secondary = gap(a.top, a.bottom, r.top, r.bottom);
          break;
        case 'right':
          if (p.x <= a.right) continue;
          primary = Math.max(0, r.left - a.right);
          secondary = gap(a.top, a.bottom, r.top, r.bottom);
          break;
        case 'up':
          if (p.y >= a.top) continue;
          primary = Math.max(0, a.top - r.bottom);
          secondary = gap(a.left, a.right, r.left, r.right);
          break;
        case 'down':
          if (p.y <= a.bottom) continue;
          primary = Math.max(0, r.top - a.bottom);
          secondary = gap(a.left, a.right, r.left, r.right);
          break;
      }

      // Targets must lie beyond the current control's edge.
      // Prefer targets straight ahead; penalise sideways drift. Centre distance
      // breaks ties between targets that are equally close.
      // Anything in the same row or column beats reaching into the next one.
      const score = primary + secondary * 2 + (secondary > 0 ? 600 : 0) + Math.hypot(dx, dy) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function moveFocus(dir) {
    const scope = !refs.x.hidden ? refs.xpanel : !refs.sheet.hidden ? refs.sheet : refs.overlay.hidden ? stage : refs.overlay;
    const candidates = focusables(scope);
    const cur = document.activeElement;
    if (!candidates.includes(cur)) {
      candidates[0]?.focus();
      return;
    }

    const inNav = !!cur.closest('.topbar');
    const view = stage.querySelector(`[data-view="${state.view}"]`);

    // Top bar → content: resume where you were in this view.
    if (inNav && dir === 'down' && scope === stage) {
      const remembered = lastFocus[state.view];
      const fallback = state.view === 'home' ? stage.querySelector('.dock-app') : focusables(view)[0];
      const target = remembered && visible(remembered) ? remembered : fallback;
      target?.focus();
      return;
    }

    const next = nearest(cur, dir, candidates);
    // Content → top bar: land on the current tab.
    if (next && !inNav && next.closest('.topbar')) {
      (stage.querySelector(`.topbar [data-nav="${state.view}"]`) || next).focus();
      return;
    }
    next?.focus();
  }

  function goBack() {
    if (!refs.x.hidden) {
      closeExpand();
    } else if (!refs.setup.hidden) {
      closeSetup();
    } else if (!refs.fit.hidden) {
      closeFit();
    } else if (!refs.sheet.hidden) {
      closeSheet();
    } else if (!refs.overlay.hidden) {
      closeOverlay();
    } else if (state.view === 'settings' && state.settingsCat) {
      const was = state.settingsCat;
      state.settingsCat = null;
      applyState();
      stage.querySelector(`[data-action="settings-cat"][data-cat="${was}"]`)?.focus();
    } else if (state.view === 'roles') {
      openView(state.rolesFrom || 'room');
    } else if (state.view === 'wallpapers' || state.view === 'cleanup' || state.view === 'guest') {
      openView('settings');
    } else if (state.view !== 'home') {
      openView('home');
      stage.querySelector('.dock-app').focus();
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!refs.fit.hidden) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') nudgeFit(e.key === 'ArrowUp' ? 1 : -1);
      if (BACK_KEYS.has(e.key)) closeFit();
      if (e.key.startsWith('Arrow') || BACK_KEYS.has(e.key)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && e.target.matches?.('[data-expand]:not(button)')) {
      e.preventDefault();
      e.target.click();
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'search-input') {
      // Search: close the keyboard and move to the first result, or hand the words to Google TV.
      e.preventDefault();
      e.target.blur();
      const first = stage.querySelector('[data-shows="titles"] .show, [data-shows="apps"] .app-card, [data-shows="free"] .show');
      if (first) first.focus();
      else if (NATIVE && state.query.trim()) nativeCall('googleSearch', state.query.trim());
      else stage.querySelector('[data-action="google-search"]')?.focus();
      return;
    }
    const inText = e.target.tagName === 'INPUT';

    if (BACK_KEYS.has(e.key) && !(inText && e.key === 'Backspace')) {
      e.preventDefault();
      goBack();
      return;
    }

    const dir = KEY_DIRECTION[e.key];
    if (!dir) return;

    const slider = document.activeElement?.dataset?.slider;
    if (slider && (dir === 'left' || dir === 'right')) {
      e.preventDefault();
      nudgeSlider(slider, dir === 'right' ? 1 : -1);
      return;
    }

    // Left/right move the caret inside a text field until it reaches an end.
    if (inText && (dir === 'left' || dir === 'right')) {
      const { selectionStart: s, selectionEnd: end, value } = e.target;
      const atEdge = dir === 'left' ? s === 0 && end === 0 : s === value.length;
      if (!atEdge) return;
    }

    e.preventDefault();
    moveFocus(dir);
  });

  setInterval(() => {
    if (document.hidden) return; // another app is on screen: do nothing
    updateClock();
    if (NATIVE) {
      if (++pollTick % 4 === 0) pollNowPlaying();
      if (state.playing && state.live) {
        state.pos = Math.min(state.pos + 1, track().durationSec);
        updatePlayback();
      }
    } else if (state.playing) {
      if (state.pos >= track().durationSec) setTrack(state.track + 1);
      else {
        state.pos += 1;
        updatePlayback();
      }
    }
  }, 1000);

  // Screen size. The launcher is drawn on a 1280x720 canvas and scaled to fit
  // the window, times the size chosen in "Fit the screen" (saved on the TV).
  const FIT_MIN = 0.6;
  const FIT_MAX = 1.1;
  const FIT_STEP = 0.02;

  function readFit() {
    try {
      const v = parseFloat(localStorage.getItem('fit'));
      return v >= FIT_MIN && v <= FIT_MAX ? v : null;
    } catch {
      return null;
    }
  }

  let userFit = readFit();

  let fitSize = { w: 0, h: 0 };
  function fit() {
    const root = document.documentElement;
    let w = innerWidth || root.clientWidth;
    let h = innerHeight || root.clientHeight;
    if (!w || !h) return; // not laid out yet; the timers below try again
    // The on-screen keyboard can shrink the window. Keep the size the page had
    // before it opened, so the page doesn't zoom out to fit what is left.
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && fitSize.h && h < fitSize.h) {
      w = fitSize.w;
      h = fitSize.h;
    } else {
      fitSize = { w, h };
    }
    stage.style.transform = `scale(${Math.min(w / 1280, h / 720) * (userFit || 1)})`;
    const diag = stage.querySelector('[data-fit-diag]');
    if (diag) diag.textContent = `Screen ${w} x ${h} at ${devicePixelRatio}x`;
  }

  function fitText() {
    const val = stage.querySelector('[data-fit-val]');
    if (val) val.textContent = `${Math.round((userFit || 1) * 100)}%`;
  }

  function openFit() {
    refs.fit.hidden = false;
    fit();
    fitText();
    refs.fit.querySelector('[data-action="fit-done"]').focus();
  }

  function nudgeFit(dir) {
    userFit = Math.min(FIT_MAX, Math.max(FIT_MIN, Math.round(((userFit || 1) + dir * FIT_STEP) * 100) / 100));
    fit();
    fitText();
  }

  function closeFit() {
    try {
      localStorage.setItem('fit', String(userFit || 1));
    } catch {
      // Storage unavailable: the size just isn't remembered.
    }
    userFit = userFit || 1;
    refs.fit.hidden = true;
    applyState();
    (stage.querySelector('.dock-app') || stage).focus();
  }

  addEventListener('resize', fit);
  addEventListener('load', fit);
  window.visualViewport?.addEventListener('resize', fit);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyState);

  // The Android shell forwards the remote's Back and Home buttons here.
  window.launcherBack = goBack;
  window.launcherHome = () => {
    if (!refs.sheet.hidden) closeSheet();
    if (!refs.overlay.hidden) closeOverlay();
    openView('home');
    stage.querySelector('.dock-app')?.focus();
  };
  // Back from an app or a settings screen: refresh what's playing and access.
  // ---------- Ambient screen ----------
  // After a while with no button pressed: photos drifting slowly, the clock
  // and the weather. The ceiling lights go off and come back when you press a key.
  let lastInput = Date.now();
  let ambientOn = false;
  let ambientOff = [];
  let ambientPic = 0;
  let ambientTimer = 0;

  function ambientShow() {
    const el = stage.querySelector('.ambient');
    const urls = D.wallpapers.map((w) => w.url);
    if (!urls.length) return;
    const layers = [el.querySelector('.amb-a'), el.querySelector('.amb-b')];
    const next = layers[ambientPic % 2];
    const prev = layers[(ambientPic + 1) % 2];
    next.style.backgroundImage = `url("${urls[ambientPic % urls.length]}")`;
    next.classList.add('on');
    prev.classList.remove('on');
    ambientPic++;
    const n = new Date();
    el.querySelector('[data-amb-clock]').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
    const w = state.weather;
    el.querySelector('[data-amb-sub]').textContent = n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (w ? `  ·  ${w.temp}°  ${w.label}` : '');
  }

  function startAmbient() {
    ambientOn = true;
    stage.querySelector('.ambient').hidden = false;
    ambientOff = lightsWithRole('ceiling').filter((l) => state.home.lights[l.id]).map((l) => l.id);
    ambientOff.forEach((id) => { state.home.lights[id] = false; nativeCall('goveePower', id, false); });
    ambientShow();
    ambientTimer = setInterval(ambientShow, 25000);
  }

  function stopAmbient() {
    ambientOn = false;
    clearInterval(ambientTimer);
    stage.querySelector('.ambient').hidden = true;
    ambientOff.forEach((id) => { state.home.lights[id] = true; nativeCall('goveePower', id, true); });
    ambientOff = [];
    applyState();
  }

  const wake = (e) => {
    lastInput = Date.now();
    if (!ambientOn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopAmbient();
  };
  document.addEventListener('keydown', wake, true);
  document.addEventListener('click', wake, true);

  setInterval(() => {
    if (document.hidden || ambientOn || !state.ambient || !refs.overlay) return;
    const busy = [refs.setup, refs.fit, refs.sheet, refs.overlay].some((o) => o && !o.hidden);
    if (!busy && Date.now() - lastInput > state.ambient * 60000) startAmbient();
  }, 5000);

  setInterval(driftStep, 1500);
  setInterval(() => { if (!document.hidden) readBacklight(); }, 20000);

  // The TV's real volume (HDMI ARC passes it to the soundbar).
  function syncVolume() {
    const v = nativeJson('volumeInfo');
    if (!v) return;
    Object.assign(state.home.sound, { volume: v.level, max: v.max || 1, muted: !!v.muted });
    applyState();
  }

  window.launcherResume = () => {
    if (!NATIVE) return;
    lastInput = Date.now();
    syncVolume();
    readBacklight();
    leaveGaming();
    renderContinue();
    tmdbKey = nativeCall('tmdbKey') || '';
    pollNowPlaying();
    refreshNativeStatus();
    if (state.view === 'cleanup') renderCleanup(); // back from the TV's Settings
    if (Date.now() - weatherAt > 15 * 60 * 1000 || state.locationPending) loadWeather();
    applyState();
  };

  // Things Android can change while we're in another app (a permission, the
  // home setting). Cheap calls, read from cache on the Android side.
  function refreshNativeStatus() {
    if (!NATIVE) return;
    state.homeDefault = nativeCall('isDefaultHome') === true;
  }

  refreshWallpapers();
  loadSaved();
  fit(); // first, so nothing below can leave the screen unscaled
  state.weather = NATIVE ? null : { ...D.weather, label: D.weather.condition, temp: D.weather.tempC };
  if (NATIVE || state.town) {
    // Show the last reading straight away; it is refreshed in the background.
    try {
      const c = JSON.parse(localStorage.getItem('weather') || 'null');
      if (c && c.w && Array.isArray(c.w.palette) && Date.now() - c.at < 6 * 3600 * 1000) { state.weather = c.w; weatherAt = c.at; }
    } catch {}
  }
  build();
  ensureGlyphs();
  new MutationObserver(() => alignFrost()).observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  stage.addEventListener('scroll', () => alignFrost(60), true);
  window.addEventListener('resize', () => alignFrost());
  alignFrost();
  let glyphTimer = 0;
  new MutationObserver(() => {
    if (!glyphTimer) glyphTimer = requestAnimationFrame(() => { glyphTimer = 0; ensureGlyphs(); });
  }).observe(document.getElementById('stage'), { childList: true, subtree: true });
  if (NATIVE || state.town) {
    setTimeout(loadWeather, 1200); // after the first screen is up
    setInterval(() => { if (!document.hidden) loadWeather(); }, 30 * 60 * 1000);
  }
  animateView('home');
  fit();
  stage.querySelector('.dock-app').focus();
  if (NATIVE) {
    try {
      syncVolume();
      tmdbKey = nativeCall('tmdbKey') || '';
      renderContinue();
      pollNowPlaying();
      applyGovee(nativeJson('goveeStatus'));
      nativeCall('goveeConnect', ''); // reads the saved key; the answer arrives as an event
      refreshNativeStatus();
    } catch (e) {
      console.warn('start-up calls failed', e);
    }
    if (userFit === null) openFit(); // first run: set the screen size
  }
  [100, 500, 1500].forEach((ms) => setTimeout(fit, ms));
})();
