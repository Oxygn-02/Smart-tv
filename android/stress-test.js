// Spams the D-pad across every tab with a slowed CPU, and reports frame times,
// input delay (key press until the next frame after focus moves), long tasks and
// where the JavaScript time goes.
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8765/launcher/index.html';
const rate = Number(process.argv[3] || 6);
const label = process.argv[4] || 'run';
const css = process.argv[5] || '';
(async () => {
  const b = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const cdp = await p.context().newCDPSession(p);
  await p.addInitScript(() => {
    const dev = (id, sku, name, o = {}) => ({ id, sku, name, light: true, on: !!o.on, color: true, white: true, brightness: true, dream: !!o.dream, lan: true });
    const names = ['Bedroom bulb', 'Floor lamp', 'Desk lamp', 'Ceiling 1', 'Ceiling 2', 'Shelf strip', 'Bed lamp', 'Hallway', 'Kitchen', 'Wardrobe', 'Plug'];
    const g = { hasKey: true, connected: true, error: '', devices: [dev('AA', 'H6097', 'TV Backlight', { dream: true, on: true }), ...names.map((n, i) => dev('L' + i, 'H60' + i, n, { on: i % 3 == 0 }))] };
    const apps = ['YouTube', 'Prime Video', 'Disney+', 'Crunchyroll', 'YouTube Music', 'BBC iPlayer', 'ITVX', 'Channel 4', 'My5', 'Netflix', 'Spotify', 'Apple TV', 'Downloader', 'Google Play Store', 'Settings', 'Live TV'].map((l, i) => ({ label: l, pkg: 'p' + i }));
    const items = [0, 1, 2].map((i) => ({ title: 'Show ' + i, sub: 'Series 1, episode ' + i, pkg: 'p' + i, uri: 'u', poster: '', pos: 600000 * (i + 1), dur: 3600000 }));
    window.Android = new Proxy({}, { get: (_, n) => ({
      goveeStatus: () => JSON.stringify(g), apps: () => JSON.stringify(apps), watchNext: () => JSON.stringify({ ok: true, items }),
      volumeInfo: () => '{"level":7,"max":15,"muted":false}', tmdbKey: () => '', guestWifi: () => '{}', chosenApps: () => '[]',
      nowPlaying: () => '{}',
    }[n] || (() => null)) });
    window.__lat = []; window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    document.addEventListener('keydown', (e) => {
      const t = performance.now();
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t))), 0);
    }, true);
  });
  await p.goto(url); if (css) await p.addStyleTag({ content: css });
  await p.waitForTimeout(2500);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
  await p.evaluate(() => { window.__f = []; let last = performance.now(); const loop = (t) => { window.__f.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  const keys = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'];
  const tabs = ['home', 'search', 'music', 'apps', 'games', 'room', 'settings', 'home'];
  let presses = 0;
  for (const tab of tabs) {
    await p.evaluate((t) => document.querySelector(`.topbar [data-nav="${t}"]`).click(), tab);
    await p.waitForTimeout(250);
    for (let r = 0; r < 4; r++) for (const k of keys) { await p.keyboard.press(k); presses++; await p.waitForTimeout(45); }
    await p.keyboard.press('Escape'); await p.waitForTimeout(80);
  }
  await p.waitForTimeout(400);
  const prof = (await cdp.send('Profiler.stop')).profile;
  const res = await p.evaluate(() => ({ f: window.__f.slice(5), lat: window.__lat, long: window.__long }));
  const q = (a, x) => { const s = [...a].sort((m, n) => m - n); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * x))] : 0; };
  const avg = (a) => a.reduce((m, n) => m + n, 0) / (a.length || 1);
  // self time per function
  const self = new Map(); const dt = prof.timeDeltas; const idIdx = new Map(prof.nodes.map((n) => [n.id, n]));
  prof.samples.forEach((id, i) => { const n = idIdx.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)') && !k.startsWith('(garbage')).sort((a, c) => c[1] - a[1]).slice(0, 8);
  console.log(`${label.padEnd(14)} throttle ${rate}x | ${presses} key presses | frames ${res.f.length} avg ${avg(res.f).toFixed(1)}ms p95 ${q(res.f, 0.95).toFixed(0)}ms worst ${Math.max(...res.f).toFixed(0)}ms >50ms: ${res.f.filter((x) => x > 50).length}`);
  console.log(`${' '.repeat(14)} input delay avg ${avg(res.lat).toFixed(0)}ms p95 ${q(res.lat, 0.95).toFixed(0)}ms worst ${Math.max(...res.lat).toFixed(0)}ms | long tasks ${res.long.length} (${res.long.reduce((m, n) => m + n, 0).toFixed(0)}ms total)`);
  console.log('   JS self time (ms):', top.map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}`).join(' | '));
  await b.close();
})();
