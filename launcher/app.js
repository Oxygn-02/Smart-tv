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
    photoIndex: 0,
    view: 'home',
    playing: true,
    track: 0,
    pos: D.music.startPositionSec,
    query: '',
    town: D.weather.town,
    games: { ...D.games },
    matchLights: false, // wallpaper gradient follows the backlight colours
    home: {
      backlight: D.smartHome.backlights.start, // scene id, 'sync' or 'off'
      lastScene: D.smartHome.backlights.start, // colours used while syncing or off
      scene: null, // room scene last applied
      lights: Object.fromEntries(D.smartHome.lights.map((l) => [l.id, l.on])),
      sound: { on: true, volume: D.smartHome.soundbar.volume, muted: false },
    },
  };

  const COUNTDOWN_STEPS = [0, 3, 5, 10];
  const RING_C = 2 * Math.PI * 34;

  const H = D.smartHome;
  const BACKLIGHT = Object.fromEntries(H.backlights.scenes.map((s) => [s.id, s]));
  const ROOM_SCENE = Object.fromEntries(H.scenes.map((s) => [s.id, s]));

  const pad = (n) => String(n).padStart(2, '0');
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
              <span class="w-empty-title">Add your town</span>
              <span class="small">Set it in Settings to see the weather</span>
            </button>
            <div class="w-weather-top">
              <span class="w-label" data-town></span>
              <svg class="w-weather-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WEATHER_ICON}</svg>
            </div>
            <div class="temp">${w.tempC}°</div>
            <div class="w-weather-foot">
              <span>${w.condition}</span>
              <span class="small">High ${w.high}°, low ${w.low}°</span>
            </div>
          </section>

          <section class="widget glass now-playing tinted w-music" data-np-card aria-label="Now playing">
            <div class="tint"></div>
            <div class="w-empty">
              ${icon('music', 34)}
              <span class="w-empty-title">Nothing playing</span>
              <span class="small">Music you play in YouTube Music shows up here</span>
              <button class="btn lg" data-focus data-app="ytmusic">Open YouTube Music</button>
            </div>
            <div class="np-top">
              <div class="np-meta">
                <div class="np-title" data-np-title></div>
                <div class="sub" data-np-artist></div>
              </div>
              <div class="np-art" data-np-art><span class="art-app">${APP.ytmusic ? appIcon(APP.ytmusic, 34) : ''}</span></div>
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
          ${D.apps.map((a, i) => `
            ${!a.pinned && D.apps[i - 1]?.pinned ? '<span class="dock-divider"></span>' : ''}
            <button class="dock-app" data-focus data-app="${a.id}" aria-label="${a.name}" style="--accent:${a.color}">
              ${appIcon(a, 76)}
              <span class="dock-label">${a.short || a.name}</span>
            </button>`).join('')}
        </nav>
      </section>`;
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
            placeholder="Search shows and films (press OK to type)" aria-label="Search">
          <span class="small" data-search-count></span>
          <button class="btn lg google-search" data-focus data-action="google-search">Search with Google TV</button>
        </label>
        <div class="search-section">
          <div class="eyebrow">Free on your apps</div>
          <div class="shows" data-shows="free"></div>
        </div>
        <div class="search-section">
          <div class="eyebrow">Rent or buy</div>
          <div class="shows" data-shows="paid"></div>
        </div>
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

  function musicView() {
    return `
      <section class="view view-music" data-view="music" hidden>
        <div class="music-grid">
          <section class="card glass music-now tinted" data-np-card aria-label="Now playing">
            <div class="tint"></div>
            <div class="music-art" data-np-art></div>
            <div class="music-meta">
              <div class="music-source">${APP.ytmusic ? appIcon(APP.ytmusic, 30) : ''}<span>${D.music.source}</span></div>
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
            <div class="light-list">
              ${H.lights.map((l) => `
                <button class="light-row" data-focus data-action="light" data-id="${l.id}">
                  <span class="light-dot"></span><span class="light-name">${l.name}</span>
                  <span class="switch" aria-hidden="true"><span></span></span>
                </button>`).join('')}
            </div>
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
          <label class="set-row">
            ${settingsRow(icon('location'), 'Weather location', 'Town for the weather card', '<input id="town-input" class="set-input" data-focus autocomplete="off" spellcheck="false">')}
          </label>
          ${row('theme', '<span data-theme-icon></span>', 'Appearance', 'Light, dark, or follow the TV', 'theme')}
          ${row('wallpaper', icon('image'), 'Wallpaper', 'Your photos, the gradient, or your light colours', 'wallpaper')}
          ${row('cycle-hdmi', icon('hdmi'), 'Games input', `Where the ${state.games.device} is plugged in`, 'hdmi')}
          ${row('toggle-auto', icon('games'), 'Switch input when Games opens', 'Turn off to stay on the launcher', 'auto')}
          ${row('cycle-countdown', icon('timer'), 'Switch countdown', 'Time to cancel before switching', 'countdown')}
          ${row('wifi', icon('wifi'), 'Wi-Fi', 'Opens Android network settings', 'wifi')}
          ${NATIVE ? `
            ${row('grant-np', icon('music'), 'Now playing access', 'Lets Home show what is playing', 'np-access')}
            ${row('grant-usage', icon('apps'), 'Recent apps access', 'Lets Home show the apps you used last', 'usage-access')}`
          : row('toggle-sample', icon('apps'), 'Sample content', 'Turn off to preview empty widgets', 'sample')}
        </section>
      </section>`;
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

  // Customize panel, after the iPadOS one: icon style, appearance, wallpaper.
  function customizeSheet() {
    const sample = APP.youtube || D.apps[0];
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
            ${[['default', 'Default', 'Brand colours'], ['dark', 'Dark', 'Dark glass'], ['clear', 'Clear', 'Frosted glass'], ['tinted', 'Tinted', 'Your light colour']]
              .map(([id, label, desc]) => opt('icon-style', id, label, desc, appIcon(sample, 76, id))).join('')}
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

  function launchApp(id) {
    const a = APP[id];
    if (!a) {
      toast('That app isn\'t installed');
      return;
    }
    if (NATIVE && a.pkg) nativeCall('launch', a.pkg);
    else toast(`Opening ${a.name}`);
  }

  // Backlight colour to the Govee H6097 over the local network (Android side).
  function sendBacklight() {
    if (!NATIVE) return;
    const h = state.home;
    const model = H.backlights.model;
    if (h.backlight === 'off') nativeCall('goveePower', model, false);
    else if (h.backlight === 'sync') nativeCall('goveeSync', model);
    else {
      const [r, g, b] = BACKLIGHT[h.backlight].colors[0].match(/\w\w/g).map((x) => parseInt(x, 16));
      nativeCall('goveeColor', model, r, g, b);
    }
  }

  // What's playing on the TV (YouTube Music or any app with a media session).
  let pollTick = 0;
  function pollNowPlaying() {
    const np = nativeJson('nowPlaying');
    const was = state.live;
    state.live = !!np;
    if (np) {
      D.music.tracks = [{
        title: np.title,
        artist: np.artist || '',
        durationSec: Math.max(1, Math.round((np.durationMs || 0) / 1000)),
        art: np.art ? `center / cover no-repeat url("${np.art}")` : 'linear-gradient(140deg,#3a3a48,#121218)',
        palette: np.colors && np.colors.length === 3 ? np.colors : null,
      }];
      state.track = 0;
      state.pos = Math.round((np.positionMs || 0) / 1000);
      state.playing = !!np.playing;
      renderTrack();
    }
    if (np || was !== state.live) applyState();
  }

  function build() {
    stage.innerHTML = `
      <div class="edge" aria-hidden="true"></div>

      <header class="topbar">
        <div class="status">
          <span class="status-time tnum" data-clock></span>
          <span class="status-date" data-date></span>
        </div>
        <nav class="tabbar glass" aria-label="Main">
          ${D.nav.map((n) => `
            <button class="tab" data-focus data-nav="${n.id}" data-tip="${n.label}" aria-label="${n.label}">${icon(n.id, 22)}</button>`).join('')}
        </nav>
        <div class="tools">
          <span class="status-wifi" title="Wi-Fi connected">${icon('wifi', 18)}</span>
          <button class="tool" data-focus data-action="match-lights" data-tip="Match lights" aria-label="Match wallpaper to backlights">${icon('drop', 20)}</button>
          <button class="tool" data-focus data-action="customize" data-tip="Customize" aria-label="Customize">${icon('sun', 20)}</button>
          <button class="tool" data-focus data-nav="settings" data-tip="Settings" aria-label="Settings">${icon('gear', 20)}</button>
        </div>
      </header>

      <div class="views">
        ${homeView()}${searchView()}${musicView()}${appsView()}${gamesView()}${roomView()}${settingsView()}
      </div>

      ${overlay()}
      ${customizeSheet()}
      <div class="toast glass" role="status" hidden></div>
    `;

    refs = {
      clock: stage.querySelector('[data-clock]'),
      date: stage.querySelector('[data-date]'),
      sheet: stage.querySelector('.sheet-scrim'),
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
    setTint(stage.querySelector('[data-weather-card]'), D.weather.palette);
    applyState();
    renderTrack();
    renderSearch();
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
    pressed('[data-action="appearance"]', (id) => id === state.appearance);
    pressed('[data-action="wallpaper-set"]', (id) => id === wp);

    all('[data-action="play"]').forEach((b) => {
      b.innerHTML = state.playing ? filledIcon('pause') : filledIcon('play');
      b.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    });

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
      'np-access': access.nowPlaying ? 'Allowed' : 'Off. Press OK to allow',
      'usage-access': access.recentApps ? 'Allowed' : 'Off. Press OK to allow',
    };
    all('[data-val]').forEach((el) => { el.textContent = values[el.dataset.val]; });
    all('[data-town]').forEach((el) => { el.textContent = state.town || 'Set your town in Settings'; });

    renderRoom();

    // Empty states: what Home shows when there's no data to fill a widget.
    const sample = state.sampleData && !NATIVE;
    stage.querySelector('.w-music').classList.toggle('is-empty', NATIVE ? !state.live : !sample);
    stage.querySelector('.w-hero').classList.toggle('is-empty', !sample);
    stage.querySelector('.w-music .np-next').hidden = !!NATIVE;
    stage.querySelector('.w-weather').classList.toggle('is-empty', !state.town);
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

    // Wallpaper gradient follows the backlights (fades between scenes).
    ['--l0', '--l1', '--l2'].forEach((v, i) => stage.style.setProperty(v, colors[i]));
    // Backlight bleed: the screen edges glow in the light colour. In "Sync to
    // TV" mode the focused item's colour takes over (see focusin below).
    if (h.backlight !== 'sync') stage.style.setProperty('--glowc', colors[0]);
    stage.querySelector('.edge').classList.toggle('off', h.backlight === 'off');
    stage.classList.toggle('lights', state.matchLights && h.backlight !== 'off');
    const matchBtn = stage.querySelector('.tool[data-action="match-lights"]');
    matchBtn.classList.toggle('on', state.matchLights);
    matchBtn.style.color = state.matchLights ? colors[0] : '';

    press('[data-action="backlight"]', (id) => id === h.backlight);
    press('[data-action="room-scene"]', (id) => id === h.scene);
    press('[data-action="light"]', (id) => h.lights[id]);

    const lightsOn = Object.values(h.lights).filter(Boolean).length;
    const swatch = stage.querySelector('[data-room-swatch]');
    swatch.style.background = h.backlight === 'off' ? 'var(--track)' : `linear-gradient(135deg, ${colors.join(',')})`;
    stage.querySelector('[data-room-scene]').textContent = h.backlight === 'off'
      ? 'Backlight off' : h.backlight === 'sync' ? 'Synced to TV' : BACKLIGHT[h.backlight].name;
    stage.querySelector('[data-room-lights]').textContent = `${lightsOn} of ${H.lights.length} lights on`;
    stage.querySelector('[data-room-sound]').textContent = !h.sound.on ? 'Soundbar off'
      : h.sound.muted ? 'Soundbar muted' : `Volume ${h.sound.volume}`;

    stage.querySelector('[data-backlight-status]').textContent = h.backlight === 'sync'
      ? 'Synced to the TV picture'
      : h.backlight === 'off' ? 'Off' : BACKLIGHT[h.backlight].name;

    const sb = h.sound;
    stage.querySelector('[data-vol-fill]').style.width = `${sb.muted ? 0 : (sb.volume / H.soundbar.volumeMax) * 100}%`;
    stage.querySelector('[data-vol]').textContent = sb.muted ? 'Muted' : sb.volume;
    stage.querySelector('[data-sound-status]').textContent = sb.on ? 'On' : 'Standby';
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
    all('[data-np-artist]').forEach((el) => { el.textContent = t.artist; });
    all('[data-duration]').forEach((el) => { el.textContent = fmt(t.durationSec); });

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

  function updatePlayback() {
    const dur = track().durationSec;
    all('[data-progress]').forEach((el) => { el.style.width = `${(state.pos / dur) * 100}%`; });
    all('[data-elapsed]').forEach((el) => { el.textContent = fmt(state.pos); });
  }

  function setTrack(i) {
    const n = D.music.tracks.length;
    state.track = ((i % n) + n) % n;
    state.pos = 0;
    renderTrack();
  }

  function renderSearch() {
    const q = state.query.trim().toLowerCase();
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
    refs.clock.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
    refs.date.textContent = n.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function showPhoto() {
    const file = D.wallpapers[state.photoIndex];
    if (file) stage.style.setProperty('--photo', `url("${D.wallpaperBase}${file}")`);
  }

  if (D.wallpapers.length > 1) {
    setInterval(() => {
      state.photoIndex = (state.photoIndex + 1) % D.wallpapers.length;
      showPhoto();
    }, D.wallpaperCycleMin * 60000);
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
    state.view = id;
    applyState();
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
    else if (act === 'grant-np') nativeCall('openSettings', 'notification-access');
    else if (act === 'grant-usage') nativeCall('openSettings', 'usage-access');
    else if (act === 'close-sheet') closeSheet();
    else if (act === 'icon-style') state.iconStyle = b.dataset.id;
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
      Object.assign(state.home.lights, sc.lights);
      setBacklight(sc.backlight);
      state.home.scene = sc.id;
      toast(`${sc.name} scene`);
      sendBacklight();
    } else if (act === 'light') {
      const id = b.dataset.id;
      state.home.lights[id] = !state.home.lights[id];
      state.home.scene = null;
    } else if (act === 'vol-up' || act === 'vol-down') {
      // TV volume; over HDMI ARC the TV passes it on to the soundbar.
      const sb = state.home.sound;
      sb.muted = false;
      sb.volume = Math.max(0, Math.min(H.soundbar.volumeMax, sb.volume + (act === 'vol-up' ? 1 : -1)));
      nativeCall('volume', act === 'vol-up' ? 1 : -1);
    } else if (act === 'mute') {
      state.home.sound.muted = !state.home.sound.muted;
      nativeCall('toggleMute');
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
  });

  stage.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
      state.query = e.target.value;
      renderSearch();
    } else if (e.target.id === 'town-input') {
      state.town = e.target.value.trim();
      applyState();
    }
  });

  // "Sync to TV": like the backlight's camera, take the colour of what's on
  // screen, here the artwork or brand colour of the focused item.
  function syncGlow(target) {
    const host = target.closest('.w-hero, .w-mini, .show, .mix, .now-playing, .music-now, .dock-app, .app-card') || target;
    const styled = [host, ...host.querySelectorAll('[style]')].find((el) => /#[0-9a-f]{6}|rgb\(/i.test(el.getAttribute('style') || ''));
    const tone = styled && (styled.getAttribute('style').match(/#[0-9a-f]{6}|rgb\([^)]*\)/i) || [])[0];
    if (tone) stage.style.setProperty('--glowc', tone);
  }

  // Remember where focus was in each view, so coming back from the sidebar
  // lands where you left off.
  const lastFocus = {};
  stage.addEventListener('focusin', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) lastFocus[view.dataset.view] = e.target;
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
    if (!refs.sheet.hidden) {
      closeSheet();
    } else if (!refs.overlay.hidden) {
      closeOverlay();
    } else if (state.view !== 'home') {
      openView('home');
      stage.querySelector('.dock-app').focus();
    }
  }

  document.addEventListener('keydown', (e) => {
    const inText = e.target.tagName === 'INPUT';

    if (BACK_KEYS.has(e.key) && !(inText && e.key === 'Backspace')) {
      e.preventDefault();
      goBack();
      return;
    }

    const dir = KEY_DIRECTION[e.key];
    if (!dir) return;

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
    updateClock();
    if (NATIVE) {
      if (++pollTick % 3 === 0) pollNowPlaying();
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

  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    stage.style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit);
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
  window.launcherResume = () => {
    if (!NATIVE) return;
    pollNowPlaying();
    applyState();
  };

  build();
  if (NATIVE) pollNowPlaying();
  animateView('home');
  fit();
  stage.querySelector('.dock-app').focus();
})();
