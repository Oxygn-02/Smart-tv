// Native bridge. Inside the Android shell (android/), the app exposes
// window.Android; this file swaps the sample data for the TV's real data
// before app.js builds the screen. In a normal browser NATIVE is null and
// nothing here runs, so the prototype keeps working as before.
const NATIVE = window.Android || null;

function nativeCall(name, ...args) {
  if (!NATIVE || typeof NATIVE[name] !== 'function') return undefined;
  try {
    return NATIVE[name](...args);
  } catch (e) {
    console.warn(`Android.${name} failed`, e);
    return undefined;
  }
}

function nativeJson(name, ...args) {
  const raw = nativeCall(name, ...args);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

if (NATIVE) {
  const D = LAUNCHER_DATA;

  // Installed TV apps, matched to our list by name so the dock keeps its
  // order. Matched apps get their package (to launch) and real icon; apps we
  // don't know about are added after the divider.
  const installed = nativeJson('apps') || [];
  const used = new Set();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Exact names first, so "YouTube Music" can't be taken for "YouTube".
  const exact = (i, a) => [a.name, a.short].filter(Boolean).some((n) => norm(i.label) === norm(n));
  const loose = (i, a) => [a.name, a.short].filter(Boolean).some((n) => norm(i.label).startsWith(norm(n)) || norm(n).startsWith(norm(i.label)));
  for (const test of [exact, loose]) {
    D.apps.forEach((a) => {
      if (a.pkg) return;
      const match = installed.find((i) => !used.has(i.pkg) && test(i, a));
      if (match) {
        a.pkg = match.pkg;
        a.iconUrl = match.icon;
        used.add(match.pkg);
      }
    });
  }
  D.apps = D.apps.filter((a) => a.pkg);
  installed.filter((i) => !used.has(i.pkg)).forEach((i) => {
    D.apps.push({ id: i.pkg, pkg: i.pkg, name: i.label, color: '#8e8e9a', mark: i.label.slice(0, 1), iconUrl: i.icon });
  });

  // Continue watching can't read other apps' Watch Next rows, so Home shows
  // the most recently used apps instead.
  const recent = nativeJson('recentApps', 4) || [];
  D.recentApps = recent
    .map((pkg) => D.apps.find((a) => a.pkg === pkg))
    .filter(Boolean)
    .slice(0, 2)
    .map((a) => a.id);
  D.continueWatching = [];
}
