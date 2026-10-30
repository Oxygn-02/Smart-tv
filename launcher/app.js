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
    matchLights: false, // wallpaper gradient follows the backlight colours
    home: {
      backlight: NATIVE ? 'none' : D.smartHome.backlights.start, // scene id, 'none' (not chosen yet), 'sync' or 'off'
      lastScene: NATIVE ? 'none' : D.smartHome.backlights.start, // colours used while syncing or off
      scene: null, // room scene last applied
      lights: Object.fromEntries(D.smartHome.lights.map((l) => [l.id, l.on])),
      sound: { on: true, volume: D.smartHome.soundbar.volume, max: D.smartHome.soundbar.volumeMax, muted: false },
    },
  };

  const COUNTDOWN_STEPS = [0, 3, 5, 10];
  const RING_C = 2 * Math.PI * 34;

  const H = D.smartHome;
  const BACKLIGHT = Object.fromEntries(H.backlights.scenes.map((s) => [s.id, s]));
  BACKLIGHT.none = { id: 'none', name: 'Not chosen yet', colors: ['#8e8e9a', '#6b6b78', '#4a4a55'] };
  const ROOM_SCENE = Object.fromEntries(H.scenes.map((s) => [s.id, s]));

  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Saved settings ----------
  // Remembered on the TV between launches (browser storage inside the app).
  const SAVED = ['appearance', 'iconStyle', 'wallpaper', 'wallpaperName', 'matchLights', 'town', 'tint'];

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
          <button class="widget glass w-room" data-focus data-nav-to="room" aria-label="Room: open lights and soundbar">
            <span class="w-label">Room</span>
            <span class="w-room-row"><span class="w-room-swatch" data-room-swatch></span><span data-room-scene></span></span>
            <span class="w-room-row">${icon('lamp', 20)}<span data-room-lights></span></span>
            <span class="w-room-row">${icon('speaker', 20)}<span data-room-sound></span></span>
          </button>

          <section class="widget glass tinted w-weather" data-weather-card aria-label="Weather">
            <div class="tint"></div>
            <button class="w-empty" data-focus data-nav-to="settings">
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

          <section class="widget glass now-playing tinted w-music" data-np-card aria-label="Now playing">
            <div class="tint"></div>
            ${npEmpty()}
            <div class="np-top">
              <div class="np-meta">
                <div class="np-title" data-np-title></div>
                <div class="sub" data-np-artist></div>
              </div>
              <div class="np-art" data-np-art><span class="art-app" data-np-src-icon="34"></span></div>
            </div>
            <div class="np-next">
              <div class="np-next-label">Up next</div>
              <div data-np-next></div>
            </div>
            ${nowPlayingControls()}
          </section>

          <section class="widget hero w-hero" aria-label="Continue watching">
            <div class="w-empty">
              ${icon('live', 34)}
              <span class="w-empty-title">Nothing to continue</span>
              <span class="small">Shows you start appear here when the app shares them</span>
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
                <button class="resume" data-focus data-toast="Resuming ${h.title} on ${h.app}">${filledIcon('play', 14)} Resume</button>
              </div>
              <div class="hero-progress">
                <div class="hero-track"><div style="width:${h.progress}%"></div></div>
                <span class="hero-left">${h.left}</span>
              </div>
            </div>
          </section>

          ${D.recentApps.map((id) => `
            <button class="widget glass w-mini w-recent" data-recent hidden data-focus data-app="${id}" aria-label="Open ${APP[id].name}">
              ${appIcon(APP[id], 64)}
              <span class="small">Recently used</span>
              <span class="w-mini-title">${APP[id].name}</span>
            </button>`).join('')}
          ${D.continueWatching.map((c) => `
            <button class="widget glass w-mini" data-cw data-focus data-toast="Resuming ${c.title} on ${c.app}" aria-label="Continue ${c.title} on ${c.app}">
              <span class="w-mini-art" style="background:${c.art}">${appIcon(APP[c.appId], 30)}</span>
              <span class="w-mini-title">${c.title}</span>
              <span class="small">${c.meta}</span>
              <span class="track"><span class="fill" style="width:${c.progress}%"></span></span>
            </button>`).join('')}
        </div>

        <nav class="dock glass" aria-label="Apps">
          ${dockApps().map((a, i, list) => `
            ${!a.pinned && list[i - 1]?.pinned ? '<span class="dock-divider"></span>' : ''}
            <button class="dock-app" data-focus data-app="${a.id}" aria-label="${a.name}" style="--accent:${a.color}">
              ${appIcon(a, 76)}
              <span class="dock-label">${a.short || a.name}</span>
            </button>`).join('')}
        </nav>
      </section>`;
  }

  // The dock keeps the apps you use, plus the three you opened last. The
  // rest are in the Apps tab.
  function dockApps() {
    const recent = (D.recentApps || []).slice(0, 3);
    const keep = D.apps.filter((a) => a.pinned || (NATIVE && recent.includes(a.id)));
    // Never leave the dock bare (no recent apps known yet): fill it up to six.
    D.apps.forEach((a) => { if (keep.length < 6 && !keep.includes(a)) keep.push(a); });
    return D.apps.filter((a) => keep.includes(a));
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
          <input id="search-input" data-focus type="search" autocomplete="off" spellcheck="false"
            placeholder="${NATIVE ? 'Search apps on this TV (press OK to type)' : 'Search shows and films (press OK to type)'}" aria-label="Search">
          <span class="small" data-search-count></span>
          <button class="btn lg google-search" data-focus data-action="google-search">Search with Google TV</button>
        </label>
        ${NATIVE ? `
        <div class="search-section">
          <div class="eyebrow" data-apps-head>Apps on this TV</div>
          <div class="shows" data-shows="apps"></div>
          <p class="small search-hint">For shows and films, where to watch and prices, use Search with Google TV.</p>
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
        <div class="games-info">
          <button class="info glass" data-focus data-action="cycle-hdmi">
            <span class="lg chip info-chip">${icon('hdmi')}</span>
            <span><span class="small">Input</span><span class="info-val" data-val="hdmi"></span></span>
          </button>
          <button class="info glass" data-focus data-action="cycle-countdown">
            <span class="lg chip info-chip">${icon('timer')}</span>
            <span><span class="small">Countdown</span><span class="info-val" data-val="countdown"></span></span>
          </button>
          <div class="info glass">
            <span class="lg chip info-chip">${icon('power')}</span>
            <span><span class="small">Console</span><span class="info-val">Wakes over HDMI-CEC</span></span>
          </div>
        </div>
      </section>`;
  }

  function roomView() {
    const sb = H.soundbar;
    return `
      <section class="view view-room" data-view="room" hidden>
        <div class="room-grid">
          <section class="card glass room-card" aria-label="${H.backlights.name}">
            <div class="room-head">
              <span class="lg chip room-chip">${icon('room')}</span>
              <span class="room-title">${H.backlights.name}<span class="small" data-backlight-status></span></span>
              <button class="btn lg" data-focus data-action="match-lights">Wallpaper follows lights: <span data-val="match"></span></button>
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
            </div>
            <div class="light-list" data-light-list></div>
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
      </section>`;
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
    return `
      <section class="view view-settings" data-view="settings" hidden>
        <section class="card glass settings" aria-label="Settings">
          <div class="set-col">
            ${row('theme', '<span data-theme-icon></span>', 'Appearance', 'Light, dark, or follow the TV', 'theme')}
            ${row('wallpaper', icon('image'), 'Wallpaper', 'Photo, gradient, or your light colours', 'wallpaper')}
            ${row('open-wallpapers', icon('image'), 'Wallpaper photos', 'Choose one, or add your own', 'wp')}
            ${row('screen-fit', icon('live'), 'Screen size', 'Resize if the edges are cropped', 'fit')}
            <label class="set-row">
              ${settingsRow(icon('location'), 'Weather town', 'Leave empty to use the TV location', '<input id="town-input" class="set-input" data-focus autocomplete="off" spellcheck="false" placeholder="TV location">')}
            </label>
            ${row('wifi', icon('wifi'), 'Wi-Fi', 'Opens the TV network settings', 'wifi')}
            ${row('open-cleanup', icon('power'), 'Clean up apps', 'Switch off apps you don\'t want', 'cleanup')}
          </div>
          <div class="set-col">
            ${row('open-setup', icon('phone'), 'Set up from your phone', 'Govee key, wallpapers, town', 'setup')}
            ${row('open-setup', icon('lamp'), 'Govee account', 'Lights and backlight', 'govee')}
            ${row('home-role', icon('home'), 'Home button', 'Which app opens on Home', 'home')}
            ${row('cycle-hdmi', icon('hdmi'), 'Games input', `Where the ${state.games.device} is plugged in`, 'hdmi')}
            ${row('toggle-auto', icon('games'), 'Switch input for Games', 'Turn off to stay here', 'auto')}
            ${row('cycle-countdown', icon('timer'), 'Switch countdown', 'Time to cancel first', 'countdown')}
            ${NATIVE ? `
              ${row('grant-np', icon('music'), 'Now playing access', 'Show what is playing', 'np-access')}
              ${row('grant-usage', icon('apps'), 'Recent apps access', 'Show the apps you used last', 'usage-access')}`
            : row('toggle-sample', icon('apps'), 'Sample content', 'Turn off to see empty widgets', 'sample')}
          </div>
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

  function renderCleanup() {
    const list = stage.querySelector('[data-cleanup-list]');
    if (!D.cleanup.length) {
      list.innerHTML = `
        <div class="cleanup-empty">
          <span class="w-empty-title">Nothing to clean up yet</span>
          <span class="small">Open Set up from your phone, download the app list there and send it over. Together we choose what goes, and this screen then lists those apps one by one.</span>
        </div>`;
      return;
    }
    const states = NATIVE ? nativeJson('packageStates', JSON.stringify(D.cleanup.map((c) => c.pkg))) || [] : [];
    list.innerHTML = '<p class="small cleanup-note">Press OK on an app to open its page. Disable switches it off; Enable brings it back, so nothing here is permanent.</p>' + D.cleanup.map((c) => {
      const st = states.find((x) => x.pkg === c.pkg);
      const value = !NATIVE ? 'On the TV' : !st || !st.installed ? 'Not on this TV' : st.enabled ? 'On' : 'Off';
      return `
        <button class="set-row" data-focus data-action="open-app-info" data-pkg="${c.pkg}">
          <span class="lg chip set-chip">${icon('power')}</span>
          <span class="set-label">${st ? st.label : c.pkg}<span class="small">${c.reason}${value === 'Off' ? ' · Switched off. Press OK, then Enable, to bring it back.' : ''}</span></span>
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

  async function getJson(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
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
      const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`);
      state.weather = {
        town: place.name,
        temp: Math.round(w.current.temperature_2m),
        high: Math.round(w.daily.temperature_2m_max[0]),
        low: Math.round(w.daily.temperature_2m_min[0]),
        ...describeWeather(w.current.weather_code, w.current.is_day),
      };
      state.weatherNote = '';
      weatherAt = Date.now();
      try { localStorage.setItem('weather', JSON.stringify({ at: weatherAt, w: state.weather })); } catch {}
    } catch {
      if (!state.weather) state.weatherNote = 'offline';
    }
    renderWeather();
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
        offline: ['No weather yet', 'Check the TV is online, or add your town in Settings'],
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
    if (state.setupOpen) renderSetupStatus();
    applyState();
  };

  function launchApp(id) {
    const a = APP[id];
    if (!a) {
      toast('That app isn\'t installed');
      return;
    }
    if (NATIVE && a.pkg) nativeCall('launch', a.pkg);
    else toast(`Opening ${a.name}`);
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
    state.govee = { hasKey: !!data.hasKey, connected: !!data.connected, error: data.error || '', devices: data.devices || [] };
    state.govee.devices.forEach((d) => {
      if (d.light) state.home.lights[d.id] = !!d.on;
    });
    if (data.message) toast(data.message);
    renderLights();
  }

  function renderLights() {
    const list = stage.querySelector('[data-light-list]');
    if (!list) return;
    const hadFocus = list.contains(document.activeElement);
    const lights = roomLights();
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
  }

  function applyScene(sc) {
    const rule = sc.lights;
    roomLights().forEach((l) => {
      state.home.lights[l.id] = rule.on;
      if (!NATIVE) return;
      if (!rule.on) {
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
        ${homeView()}${searchView()}${musicView()}${appsView()}${gamesView()}${roomView()}${settingsView()}${wallpapersView()}${cleanupView()}
      </div>

      ${overlay()}
      ${customizeSheet()}
      ${fitOverlay()}
      ${setupOverlay()}
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
      sample: state.sampleData ? 'On' : 'Off',
      wp: wallpaperLabel(),
      setup: NATIVE ? 'Press OK' : 'On the TV',
      cleanup: D.cleanup.length ? `${D.cleanup.length} apps` : 'Nothing yet',
      govee: !NATIVE ? 'On the TV'
        : state.govee.connected ? `Connected, ${state.govee.devices.length} devices`
          : state.govee.hasKey ? (state.govee.error || 'Connecting') : 'Not connected',
      home: !NATIVE ? 'On the TV' : state.homeDefault ? 'This launcher' : 'Google TV. Press OK',
      fit: `${Math.round((userFit || 1) * 100)}%`,
      'np-access': access.nowPlaying ? 'Allowed' : 'Off. Press OK to allow',
      'usage-access': access.recentApps ? 'Allowed' : 'Off. Press OK to allow',
    };
    all('[data-val]').forEach((el) => { el.textContent = values[el.dataset.val]; });
    renderWeather();

    renderRoom();

    // Empty states: what Home shows when there's no data to fill a widget.
    const sample = state.sampleData && !NATIVE;
    stage.querySelector('.w-music').classList.toggle('is-empty', NATIVE ? !state.live : !sample);
    if (NATIVE) {
      const noAccess = !access.nowPlaying;
      all('[data-np-empty-title]').forEach((el) => { el.textContent = noAccess ? 'Allow Now playing' : 'Nothing playing'; });
      all('[data-np-empty-text]').forEach((el) => {
        el.textContent = noAccess
          ? 'Turn on access to show what is playing, from any app or cast from a phone'
          : 'Anything playing on the TV shows up here, including music cast from a phone';
      });
      all('[data-np-allow]').forEach((el) => { el.hidden = !noAccess; });
      all('[data-np-open]').forEach((el) => { el.hidden = noAccess || !APP.ytmusic; });
      // The Music tab shows only what's really playing; the sample mixes are for the preview.
      stage.querySelector('[data-music-empty]').hidden = state.live;
      stage.querySelector('.music-grid').hidden = !state.live;
      stage.querySelector('.music-mixes').hidden = true;
    }
    stage.querySelector('.w-hero').classList.toggle('is-empty', !sample);
    stage.querySelector('.w-music .np-next').hidden = !!NATIVE;
    all('[data-cw]').forEach((el) => { el.hidden = !sample; });
    all('[data-recent]').forEach((el) => { el.hidden = sample; });

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
    if (h.backlight !== 'sync') state.glow = null;
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
    stage.querySelector('[data-room-lights]').textContent = roomList.length ? `${lightsOn} of ${roomList.length} lights on` : 'No lights yet';
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
    if (!list.length) el.innerHTML = `<div class="empty small">No app called “${state.query.trim()}”. Try Search with Google TV.</div>`;
    stage.querySelector('[data-search-count]').textContent = q ? `${list.length} app${list.length === 1 ? '' : 's'}` : '';
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
    animateView(id);
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
  function showInputScreen() {
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
    const b = e.target.closest('button');
    if (!b) return;
    const g = state.games;
    const act = b.dataset.action;

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
    else if (act === 'home-role') {
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
    } else if (act === 'match-lights') {
      state.matchLights = !state.matchLights;
      toast(state.matchLights ? 'Wallpaper now matches your backlights' : 'Wallpaper back to your own');
    } else if (act === 'backlight') {
      setBacklight(b.dataset.id);
      state.home.scene = null;
      const id = b.dataset.id;
      toast(`TV backlight: ${id === 'sync' ? 'matching the picture' : id === 'off' ? 'off' : BACKLIGHT[id].name}`);
      sendBacklight();
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

  // Remember where focus was in each view, so coming back from the sidebar
  // lands where you left off.
  const lastFocus = {};
  stage.addEventListener('focusin', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) lastFocus[view.dataset.view] = e.target;
    stage.querySelector('.dock')?.classList.toggle('active', !!e.target.closest('.dock'));
    if (state.home.backlight === 'sync') syncGlow(e.target);
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
    const scope = !refs.sheet.hidden ? refs.sheet : refs.overlay.hidden ? stage : refs.overlay;
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
    if (!refs.setup.hidden) {
      closeSetup();
    } else if (!refs.fit.hidden) {
      closeFit();
    } else if (!refs.sheet.hidden) {
      closeSheet();
    } else if (!refs.overlay.hidden) {
      closeOverlay();
    } else if (state.view === 'wallpapers' || state.view === 'cleanup') {
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

  function fit() {
    const root = document.documentElement;
    const w = innerWidth || root.clientWidth;
    const h = innerHeight || root.clientHeight;
    if (!w || !h) return; // not laid out yet; the timers below try again
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
  // The TV's real volume (HDMI ARC passes it to the soundbar).
  function syncVolume() {
    const v = nativeJson('volumeInfo');
    if (!v) return;
    Object.assign(state.home.sound, { volume: v.level, max: v.max || 1, muted: !!v.muted });
    applyState();
  }

  window.launcherResume = () => {
    if (!NATIVE) return;
    syncVolume();
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
