(function () {
  const D = LAUNCHER_DATA;
  const stage = document.getElementById('stage');

  // Start in the host's theme (an explicit data-theme, else the OS setting). Dark when unknown.
  function initialTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  const state = {
    theme: initialTheme(), // 'dark' | 'light'
    wallpaper: 'gradient', // 'gradient' | 'photo'
    nav: 'home',
    playing: true,
    pos: D.nowPlaying.positionSec,
  };

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

  // Build the whole screen once. Later updates touch only the nodes that change,
  // so the focused element survives the 1-second tick.
  function build() {
    const np = D.nowPlaying;
    const w = D.weather;
    const h = D.hero;

    stage.innerHTML = `
      <div class="photolabel" hidden>[ Your photo wallpaper here ]</div>

      <nav class="pill glass" aria-label="Main">
        ${D.nav.map((n) => `
          <button class="ib" data-focus data-nav="${n.id}" aria-label="${n.label}">${icon(n.id)}</button>`).join('')}
        <div class="div"></div>
        <button class="ib" data-focus data-action="wifi" aria-label="Wi-Fi">${icon('wifi')}</button>
        <button class="ib" data-focus data-action="theme"></button>
        <button class="ib" data-focus data-action="wallpaper"></button>
        <button class="ib" data-focus data-action="settings" aria-label="Settings">${icon('gear')}</button>
      </nav>

      <header class="header">
        <div class="clock-row">
          <div class="clock" data-clock></div>
          <div class="sub" data-date></div>
        </div>
        <div class="sub">${w.tempC}° · ${w.condition}</div>
      </header>

      <main class="grid">
        <div class="col">
          <section class="card glass now-playing" aria-label="Now playing">
            <div class="eyebrow">${icon('playCircle', 14)}<span>Now playing · ${np.source}</span></div>
            <div class="np-body">
              <div class="np-art" style="background:${np.art}"></div>
              <div class="np-meta">
                <div class="np-title">${np.title}</div>
                <div class="sub">${np.artist}</div>
              </div>
            </div>
            <div class="np-controls">
              <div class="track"><div class="fill" data-progress></div></div>
              <div class="np-row">
                <span class="small" data-elapsed></span>
                <div class="transport">
                  <button class="ctrl" data-focus data-action="prev" aria-label="Previous">${icon('prev', 18)}</button>
                  <button class="play" data-focus data-action="play"></button>
                  <button class="ctrl" data-focus data-action="next" aria-label="Next">${icon('next', 18)}</button>
                </div>
                <span class="small">${fmt(np.durationSec)}</span>
              </div>
            </div>
          </section>

          <section class="card glass weather" aria-label="Weather">
            <div class="weather-text">
              <div class="eyebrow"><span>${w.town}</span></div>
              <div class="temp">${w.tempC}°</div>
              <div class="small">${w.condition} · H ${w.high}° L ${w.low}°</div>
            </div>
            <svg class="weather-icon" width="96" height="96" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WEATHER_ICON}</svg>
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
                <button class="resume" data-focus data-action="resume">▶ Resume</button>
              </div>
              <div class="hero-track"><div style="width:${h.progress}%"></div></div>
            </div>
          </section>

          <div class="also">
            ${D.continueWatching.map((c) => `
              <button class="mini glass" data-focus aria-label="Continue ${c.title} on ${c.app}">
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
      </main>

      <div class="apps">
        ${D.apps.map((a) => `
          <button class="app glass" data-focus data-app="${a.id}" aria-label="${a.name}"
            style="--accent:${a.color};--glow:${a.color}55">
            <span class="app-swatch" style="background:${a.color}"></span>
            <span class="app-name">${a.name}</span>
          </button>`).join('')}
      </div>
    `;

    cache();
    applyState();
    updateClock();
    updatePlayback();
  }

  let refs = {};
  function cache() {
    refs = {
      clock: stage.querySelector('[data-clock]'),
      date: stage.querySelector('[data-date]'),
      progress: stage.querySelector('[data-progress]'),
      elapsed: stage.querySelector('[data-elapsed]'),
      play: stage.querySelector('[data-action="play"]'),
      theme: stage.querySelector('[data-action="theme"]'),
      wallpaper: stage.querySelector('[data-action="wallpaper"]'),
      photoLabel: stage.querySelector('.photolabel'),
    };
  }

  function applyState() {
    const dark = state.theme === 'dark';
    const photo = state.wallpaper === 'photo';

    stage.classList.toggle('light', !dark);
    stage.classList.toggle('photo', photo);
    refs.photoLabel.hidden = !photo;

    refs.theme.innerHTML = icon(dark ? 'sun' : 'moon');
    refs.theme.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');

    refs.wallpaper.innerHTML = icon('image');
    refs.wallpaper.setAttribute('aria-label', photo ? 'Use gradient wallpaper' : 'Use photo wallpaper');

    refs.play.innerHTML = state.playing ? filledIcon('pause') : filledIcon('play');
    refs.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');

    stage.querySelectorAll('[data-nav]').forEach((b) => {
      const on = b.dataset.nav === state.nav;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function updateClock() {
    const n = new Date();
    refs.clock.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
    refs.date.textContent = n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function updatePlayback() {
    const dur = D.nowPlaying.durationSec;
    refs.progress.style.width = `${Math.round((state.pos / dur) * 100)}%`;
    refs.elapsed.textContent = fmt(state.pos);
  }

  function launch(id) {
    // Prototype only. On device this starts the app's launch intent.
    console.info('launch', id);
  }

  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.nav) state.nav = b.dataset.nav;
    else if (b.dataset.app) launch(b.dataset.app);
    else if (b.dataset.action === 'theme') state.theme = state.theme === 'dark' ? 'light' : 'dark';
    else if (b.dataset.action === 'wallpaper') state.wallpaper = state.wallpaper === 'photo' ? 'gradient' : 'photo';
    else if (b.dataset.action === 'play') state.playing = !state.playing;
    else if (b.dataset.action === 'prev') state.pos = 0;
    else if (b.dataset.action === 'next') state.pos = Math.min(state.pos + 10, D.nowPlaying.durationSec);

    applyState();
    updatePlayback();
  });

  // D-pad: arrow keys move focus to the nearest focusable control in that direction.
  const KEY_DIRECTION = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };

  function centre(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function moveFocus(dir) {
    const all = [...stage.querySelectorAll('[data-focus]')];
    const cur = document.activeElement;
    if (!all.includes(cur)) {
      all[0]?.focus();
      return;
    }

    const c = centre(cur);
    let best = null;
    let bestScore = Infinity;

    for (const el of all) {
      if (el === cur) continue;
      const p = centre(el);
      const dx = p.x - c.x;
      const dy = p.y - c.y;

      let primary;
      let secondary;
      switch (dir) {
        case 'left':
          if (dx >= -1) continue;
          primary = -dx;
          secondary = Math.abs(dy);
          break;
        case 'right':
          if (dx <= 1) continue;
          primary = dx;
          secondary = Math.abs(dy);
          break;
        case 'up':
          if (dy >= -1) continue;
          primary = -dy;
          secondary = Math.abs(dx);
          break;
        case 'down':
          if (dy <= 1) continue;
          primary = dy;
          secondary = Math.abs(dx);
          break;
      }

      // Prefer targets straight ahead; penalise sideways drift.
      const score = primary + secondary * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    best?.focus();
  }

  document.addEventListener('keydown', (e) => {
    const dir = KEY_DIRECTION[e.key];
    if (!dir) return;
    e.preventDefault();
    moveFocus(dir);
  });

  setInterval(() => {
    updateClock();
    if (state.playing) {
      state.pos = state.pos >= D.nowPlaying.durationSec ? 0 : state.pos + 1;
      updatePlayback();
    }
  }, 1000);

  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    stage.style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit);

  build();
  fit();
  stage.querySelector('[data-nav="home"]').focus();
})();
