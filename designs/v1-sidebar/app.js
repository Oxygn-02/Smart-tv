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
    theme: initialTheme(), // 'dark' | 'light'
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

  function homeView() {
    const w = D.weather;
    const h = D.hero;
    return `
      <section class="view view-home" data-view="home">
        <div class="grid">
          <div class="col">
            <section class="card glass now-playing tinted" data-np-card aria-label="Now playing">
              <div class="tint"></div>
              <div class="np-left">
                <div class="eyebrow">${icon('playCircle', 14)}<span>${D.music.source}</span></div>
                <div class="np-meta">
                  <div class="np-title" data-np-title></div>
                  <div class="sub" data-np-artist></div>
                </div>
                ${nowPlayingControls()}
              </div>
              <div class="np-art" data-np-art></div>
            </section>

            <section class="card glass weather tinted" data-weather-card aria-label="Weather">
              <div class="tint"></div>
              <div class="weather-text">
                <div class="eyebrow"><span data-town></span></div>
                <div class="temp">${w.tempC}°</div>
                <div class="small">${w.condition} · H ${w.high}° L ${w.low}°</div>
              </div>
              <span class="lg chip weather-chip">
                <svg width="72" height="72" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WEATHER_ICON}</svg>
              </span>
            </section>
          </div>

          <div class="col">
            <section class="card hero" aria-label="Continue watching">
              <div class="hero-art" style="background:${h.art}"></div>
              <div class="hero-shade"></div>
              <div class="hero-label">Continue watching</div>
              <div class="hero-body">
                <div class="hero-app"><span class="dot" style="background:${h.appColor}"></span>${h.app}</div>
                <div class="hero-row">
                  <div>
                    <div class="hero-title">${h.title}</div>
                    <div class="hero-sub">${h.subtitle}</div>
                  </div>
                  <button class="resume" data-focus data-toast="Resuming ${h.title} on ${h.app}">▶ Resume</button>
                </div>
                <div class="hero-track"><div style="width:${h.progress}%"></div></div>
              </div>
            </section>

            <div class="also">
              ${D.continueWatching.map((c) => `
                <button class="mini glass" data-focus data-toast="Resuming ${c.title} on ${c.app}" aria-label="Continue ${c.title} on ${c.app}">
                  <div class="mini-art" style="background:${c.art}"></div>
                  <div class="mini-body">
                    <div class="small">${c.app}</div>
                    <div class="mini-title">${c.title}</div>
                    <div class="small">${c.meta}</div>
                    <div class="track" style="margin-top:6px"><div class="fill" style="width:${c.progress}%"></div></div>
                  </div>
                </button>`).join('')}
            </div>
          </div>
        </div>

        <div class="apps">
          ${D.apps.filter((a) => a.pinned).map((a) => appTile(a, 'app glass', 46)).join('')}
        </div>
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
            placeholder="Search shows and films on your apps" aria-label="Search">
          <span class="small" data-search-count></span>
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
              <div class="eyebrow">${icon('playCircle', 14)}<span>Now playing · ${D.music.source}</span></div>
              <div>
                <div class="music-title" data-np-title></div>
                <div class="sub" data-np-artist></div>
              </div>
              ${nowPlayingControls()}
            </div>
          </section>
          <section class="card glass music-queue" aria-label="Up next">
            <div class="eyebrow">${icon('queue', 14)}<span>Up next</span></div>
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

  function liveView() {
    return `
      <section class="view view-live" data-view="live" hidden>
        <div class="live-head">
          <div class="eyebrow">Freeview · On now</div>
          <div class="small">Opens live in the channel's app</div>
        </div>
        <div class="channels">
          ${D.liveTv.map((c, i) => `
            <button class="channel glass" data-focus data-channel="${i}"
              data-toast="Opening ${c.name} live in ${APP[c.app].name}" aria-label="${c.name}, now ${c.now}">
              <span class="lg chip channel-num tnum">${Number(c.number)}</span>
              <span class="channel-name">
                <span class="channel-title">${c.name}</span>
                <span class="small">${APP[c.app].name}</span>
              </span>
              <span class="channel-now">
                <span class="channel-prog">${c.now}</span>
                <span class="small tnum" data-live-time="${i}"></span>
                <span class="track"><span class="fill" data-live-progress="${i}"></span></span>
              </span>
              <span class="channel-next">
                <span class="small">Next · <span class="tnum" data-live-next="${i}"></span></span>
                <span class="channel-next-prog">${c.next}</span>
              </span>
            </button>`).join('')}
        </div>
      </section>`;
  }

  function appsView() {
    return `
      <section class="view view-apps" data-view="apps" hidden>
        <div class="eyebrow">${D.apps.length} apps installed</div>
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
            <div class="eyebrow">Games</div>
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
              <span class="room-title">${H.backlights.name}<span class="small">Govee ${H.backlights.model} · <span data-backlight-status></span></span></span>
              <button class="btn lg" data-focus data-action="match-lights">Match wallpaper: <span data-val="match"></span></button>
            </div>
            <div class="swatches">
              <button class="swatch" data-focus data-action="backlight" data-id="sync">
                <span class="swatch-dot lg chip">${icon('sync', 26)}</span><span class="small">Match picture</span>
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
                  <span class="small" data-light-state="${l.id}"></span>
                </button>`).join('')}
            </div>
          </section>
        </div>

        <section class="card glass soundbar" aria-label="Soundbar">
          <div class="room-head">
            <span class="lg chip room-chip">${icon('speaker')}</span>
            <span class="room-title">${sb.name}<span class="small">${sb.connection} · <span data-sound-status></span></span></span>
            <div class="volume">
              <button class="ctrl lg" data-focus data-action="vol-down" aria-label="Volume down">${icon('minus', 18)}</button>
              <span class="track vol-track"><span class="fill" data-vol-fill></span></span>
              <span class="vol-num tnum" data-vol></span>
              <button class="ctrl lg" data-focus data-action="vol-up" aria-label="Volume up">${icon('plus', 18)}</button>
              <button class="ctrl lg" data-focus data-action="mute" aria-label="Mute">${icon('volume', 18)}</button>
              <button class="ctrl lg" data-focus data-action="sb-power" aria-label="Soundbar power">${icon('power', 18)}</button>
            </div>
          </div>
          <div class="pill-row">
            <span class="small">Volume, mute and power go through the TV over HDMI-CEC. Sound modes stay on the D50 remote.</span>
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
          ${row('theme', '<span data-theme-icon></span>', 'Appearance', 'Light or dark', 'theme')}
          ${row('wallpaper', icon('image'), 'Wallpaper', 'Gradient, or your photos from wallpapers/', 'wallpaper')}
          ${row('cycle-hdmi', icon('hdmi'), 'Games input', `Where the ${state.games.device} is plugged in`, 'hdmi')}
          ${row('toggle-auto', icon('games'), 'Switch input when Games opens', 'Turn off to stay on the launcher', 'auto')}
          ${row('cycle-countdown', icon('timer'), 'Switch countdown', 'Time to cancel before switching', 'countdown')}
          ${row('wifi', icon('wifi'), 'Wi-Fi', 'Opens Android network settings', 'wifi')}
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
          <div class="sub">${state.games.device} · press Back to stay here</div>
          <button class="btn lg" data-focus data-action="cancel-switch">Stay on launcher</button>
        </div>
        <div class="input-screen" data-input-screen hidden>
          <div class="input-label"><span data-val="hdmi"></span> · ${state.games.device}</div>
          <div class="input-hint">
            <div>The TV is showing your ${state.games.device}.</div>
            <button class="btn lg" data-focus data-action="close-overlay">Back to launcher</button>
          </div>
        </div>
      </div>`;
  }

  function build() {
    stage.innerHTML = `
      <div class="photolabel" hidden>[ Your photo wallpaper here ]</div>

      <nav class="pill glass" aria-label="Main">
        ${D.nav.map((n) => `
          <button class="ib" data-focus data-nav="${n.id}" aria-label="${n.label}">${icon(n.id)}</button>`).join('')}
        <div class="div"></div>
        <button class="ib" data-focus data-action="wifi" aria-label="Wi-Fi">${icon('wifi')}</button>
        <button class="ib" data-focus data-action="theme" data-theme-icon></button>
        <button class="ib" data-focus data-action="wallpaper"></button>
        <button class="ib" data-focus data-action="match-lights" aria-label="Match wallpaper to backlights">${icon('drop')}</button>
        <button class="ib" data-focus data-nav="settings" aria-label="Settings">${icon('gear')}</button>
      </nav>

      <header class="header">
        <div class="clock-row">
          <div class="clock tnum" data-clock></div>
          <div class="sub" data-date></div>
        </div>
        <div class="sub">${D.weather.tempC}° · ${D.weather.condition}</div>
      </header>

      <div class="views">
        ${homeView()}${searchView()}${musicView()}${liveView()}${appsView()}${gamesView()}${roomView()}${settingsView()}
      </div>

      ${overlay()}
      <div class="toast glass" role="status" hidden></div>
    `;

    refs = {
      clock: stage.querySelector('[data-clock]'),
      date: stage.querySelector('[data-date]'),
      themeBtn: stage.querySelector('.ib[data-action="theme"]'),
      wallpaperBtn: stage.querySelector('.ib[data-action="wallpaper"]'),
      photoLabel: stage.querySelector('.photolabel'),
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
    updateLive();
  }

  let refs = {};
  const all = (sel) => stage.querySelectorAll(sel);

  // ---------- State to DOM ----------

  function applyState() {
    const dark = state.theme === 'dark';
    const photo = state.wallpaper === 'photo';
    const g = state.games;

    stage.classList.toggle('light', !dark);
    stage.classList.toggle('photo', photo);
    refs.photoLabel.hidden = !photo || D.wallpapers.length > 0;

    all('[data-theme-icon]').forEach((el) => { el.innerHTML = icon(dark ? 'sun' : 'moon'); });
    refs.themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    refs.wallpaperBtn.innerHTML = icon('image');
    refs.wallpaperBtn.setAttribute('aria-label', photo ? 'Use gradient wallpaper' : 'Use photo wallpaper');

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

    const values = {
      theme: dark ? 'Dark' : 'Light',
      wallpaper: photo ? 'Photos' : 'Gradient',
      hdmi: `HDMI ${g.hdmiPort}`,
      auto: g.autoSwitch ? 'On' : 'Off',
      countdown: g.countdownSec ? `${g.countdownSec} s` : 'None',
      wifi: 'Connected',
      match: state.matchLights ? 'On' : 'Off',
    };
    all('[data-val]').forEach((el) => { el.textContent = values[el.dataset.val]; });
    all('[data-town]').forEach((el) => { el.textContent = state.town || 'Set your town in Settings'; });

    renderRoom();

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
    stage.classList.toggle('lights', state.matchLights && h.backlight !== 'off');
    const matchBtn = stage.querySelector('.ib[data-action="match-lights"]');
    matchBtn.classList.toggle('on', state.matchLights);
    matchBtn.style.color = state.matchLights ? colors[0] : '';

    press('[data-action="backlight"]', (id) => id === h.backlight);
    press('[data-action="room-scene"]', (id) => id === h.scene);
    press('[data-action="light"]', (id) => h.lights[id]);
    all('[data-light-state]').forEach((el) => { el.textContent = h.lights[el.dataset.lightState] ? 'On' : 'Off'; });

    stage.querySelector('[data-backlight-status]').textContent = h.backlight === 'sync'
      ? 'Matching the picture'
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
    all('[data-np-card]').forEach((el) => setTint(el, artPalette(t.art)));
    all('[data-np-title]').forEach((el) => { el.textContent = t.title; });
    all('[data-np-artist]').forEach((el) => { el.textContent = t.artist; });
    all('[data-duration]').forEach((el) => { el.textContent = fmt(t.durationSec); });

    const tracks = D.music.tracks;
    const queue = stage.querySelector('[data-queue]');
    const hadFocus = queue.contains(document.activeElement);
    queue.innerHTML = [1, 2, 3, 4, 5].map((k) => {
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
    refs.date.textContent = n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function hm(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Programmes run in fixed slots so the guide always shows something on now.
  function updateLive() {
    const now = Date.now();
    D.liveTv.forEach((c, i) => {
      const slot = c.slotMin * 60000;
      const start = Math.floor(now / slot) * slot;
      const end = start + slot;
      stage.querySelector(`[data-live-time="${i}"]`).textContent = `${hm(new Date(start))} – ${hm(new Date(end))}`;
      stage.querySelector(`[data-live-next="${i}"]`).textContent = hm(new Date(end));
      stage.querySelector(`[data-live-progress="${i}"]`).style.width = `${((now - start) / slot) * 100}%`;
    });
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

  // Blocks that animate in when a view opens, staggered in reading order.
  const ANIM_SELECTOR = ':is(.grid > .col > *, .also > *, .apps > *, .search-bar, .search-section, '
    + '.music-grid > *, .music-mixes, .live-head, .channel, .view-apps > .eyebrow, .app-card, '
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

  // Prototype stand-in for the TV leaving the launcher for the HDMI input.
  function showInputScreen() {
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
    else if (b.dataset.app) toast(`Opening ${APP[b.dataset.app].name}`);
    else if (b.dataset.track) setTrack(Number(b.dataset.track));
    else if (b.dataset.toast) toast(b.dataset.toast);
    else if (act === 'theme') state.theme = state.theme === 'dark' ? 'light' : 'dark';
    else if (act === 'wallpaper') {
      state.wallpaper = state.wallpaper === 'photo' ? 'gradient' : 'photo';
      state.matchLights = false;
    } else if (act === 'match-lights') {
      state.matchLights = !state.matchLights;
      toast(state.matchLights ? 'Wallpaper now matches your backlights' : 'Wallpaper back to your own');
    } else if (act === 'backlight') {
      setBacklight(b.dataset.id);
      state.home.scene = null;
      const id = b.dataset.id;
      toast(`TV backlights: ${id === 'sync' ? 'matching the picture' : id === 'off' ? 'off' : BACKLIGHT[id].name}`);
    } else if (act === 'room-scene') {
      const sc = ROOM_SCENE[b.dataset.id];
      Object.assign(state.home.lights, sc.lights);
      setBacklight(sc.backlight);
      state.home.scene = sc.id;
      toast(`${sc.name} scene`);
    } else if (act === 'light') {
      const id = b.dataset.id;
      state.home.lights[id] = !state.home.lights[id];
      state.home.scene = null;
    } else if (act === 'sb-power') {
      const sb = state.home.sound;
      sb.on = !sb.on;
      toast(`Soundbar ${sb.on ? 'on' : 'in standby'}`);
    } else if (act === 'vol-up' || act === 'vol-down') {
      const sb = state.home.sound;
      sb.muted = false;
      sb.volume = Math.max(0, Math.min(H.soundbar.volumeMax, sb.volume + (act === 'vol-up' ? 1 : -1)));
    } else if (act === 'mute') {
      state.home.sound.muted = !state.home.sound.muted;
    }
    else if (act === 'play') state.playing = !state.playing;
    else if (act === 'prev') {
      if (state.pos > 3) state.pos = 0;
      else setTrack(state.track - 1);
    }
    else if (act === 'next') setTrack(state.track + 1);
    else if (act === 'switch-now') startSwitch();
    else if (act === 'cancel-switch' || act === 'close-overlay') closeOverlay();
    else if (act === 'toggle-auto') g.autoSwitch = !g.autoSwitch;
    else if (act === 'cycle-hdmi') g.hdmiPort = (g.hdmiPort % 4) + 1;
    else if (act === 'cycle-countdown') g.countdownSec = COUNTDOWN_STEPS[(COUNTDOWN_STEPS.indexOf(g.countdownSec) + 1) % COUNTDOWN_STEPS.length];
    else if (act === 'wifi') {
      if (state.view === 'settings') toast('Opens Android Wi-Fi settings on the TV');
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

  // Remember where focus was in each view, so coming back from the sidebar
  // lands where you left off.
  const lastFocus = {};
  stage.addEventListener('focusin', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) lastFocus[view.dataset.view] = e.target;
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
      const score = primary + secondary * 2 + Math.hypot(dx, dy) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function moveFocus(dir) {
    const scope = refs.overlay.hidden ? stage : refs.overlay;
    const candidates = focusables(scope);
    const cur = document.activeElement;
    if (!candidates.includes(cur)) {
      candidates[0]?.focus();
      return;
    }

    const inNav = !!cur.closest('.pill');
    const view = stage.querySelector(`[data-view="${state.view}"]`);

    // Sidebar → content: resume where you were in this view.
    if (inNav && dir === 'right' && scope === stage) {
      const remembered = lastFocus[state.view];
      const target = remembered && visible(remembered) ? remembered : focusables(view)[0];
      target?.focus();
      return;
    }

    const next = nearest(cur, dir, candidates);
    // Content → sidebar: land on the current tab.
    if (next && !inNav && next.closest('.pill')) {
      (stage.querySelector(`.pill [data-nav="${state.view}"]`) || next).focus();
      return;
    }
    next?.focus();
  }

  function goBack() {
    if (!refs.overlay.hidden) {
      closeOverlay();
    } else if (state.view !== 'home') {
      openView('home');
      stage.querySelector('[data-nav="home"]').focus();
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
    updateLive();
    if (state.playing) {
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

  build();
  animateView('home');
  fit();
  stage.querySelector('[data-nav="home"]').focus();
})();
