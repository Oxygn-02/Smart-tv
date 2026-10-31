// Placeholder data for the prototype. On device these come from:
// - apps: PackageManager (getApplicationIcon / getApplicationBanner)
// - music: MediaSessionManager.getActiveSessions() (YouTube Music session + queue)
// - continueWatching: TvContractCompat.WatchNextPrograms (fallback: UsageStatsManager)
// - search: each installed app's Android TV global-search provider, plus a
//   price lookup for titles that are only available to rent or buy
// - weather: Open-Meteo (location set in Settings)
// Show titles, tracks and programmes are made up; channel names are real.
const LAUNCHER_DATA = {
  nav: [
    { id: 'home', label: 'Home' },
    { id: 'search', label: 'Search' },
    { id: 'music', label: 'Music' },
    { id: 'apps', label: 'Apps' },
    { id: 'games', label: 'Games' },
    { id: 'room', label: 'Room' },
  ],

  // Installed apps, in "All apps" order. `pinned` apps make the Home row.
  // `logo` names a real logo in icons.js; `mark` is a lettermark used until
  // the device supplies the real icon.
  apps: [
    { id: 'youtube', name: 'YouTube', color: '#ff3b3b', logo: 'youtube', pinned: true },
    { id: 'iplayer', name: 'BBC iPlayer', short: 'iPlayer', color: '#ff4fa3', glyph: 'iplayer', mark: 'iP', pinned: true },
    { id: 'itvx', name: 'ITVX', color: '#e6c341', logo: 'itvx', pinned: true },
    { id: 'c4', name: 'Channel 4', color: '#47c98f', logo: 'channel4', pinned: true },
    { id: 'my5', name: 'My5', color: '#4f8fff', glyph: 'my5', mark: '5', pinned: true },
    { id: 'prime', name: 'Prime Video', color: '#38b6f0', logo: 'primevideo', pinned: true },
    { id: 'ytmusic', name: 'YouTube Music', short: 'YT Music', color: '#ff5a5a', logo: 'youtubemusic', pinned: true },
    { id: 'playstore', name: 'Google Play Store', short: 'Play Store', color: '#5bb974', logo: 'googleplay' },
    { id: 'playmovies', name: 'Google TV', color: '#8ab4f8', glyph: 'googletv', mark: 'TV' },
  ],

  music: {
    source: 'YouTube Music',
    startPositionSec: 83,
    tracks: [
      { title: 'Late Night Static', artist: 'Neon Harbour', durationSec: 222, art: 'linear-gradient(140deg,#e8735a 0%,#8b3a7a 55%,#2c1d4f 100%)' },
      { title: 'Paper Lanterns', artist: 'Mara Quill', durationSec: 198, art: 'linear-gradient(140deg,#f2c46d 0%,#c0603a 60%,#3b1d1a 100%)' },
      { title: 'Low Tide', artist: 'The Cold Coast', durationSec: 245, art: 'linear-gradient(140deg,#6fc3c9 0%,#2f6c8f 55%,#152238 100%)' },
      { title: 'Signal Fire', artist: 'Neon Harbour', durationSec: 211, art: 'linear-gradient(140deg,#ff8a5c 0%,#b8324f 55%,#3a1430 100%)' },
      { title: 'Glasshouse', artist: 'Orla Vey', durationSec: 186, art: 'linear-gradient(140deg,#b9e3a6 0%,#4f8f6b 55%,#16302a 100%)' },
      { title: 'Northern Line', artist: 'Kit Arden', durationSec: 233, art: 'linear-gradient(140deg,#a9b4ff 0%,#5a55b5 55%,#1f1a45 100%)' },
    ],
    mixes: [
      { title: 'Supermix', sub: 'Your favourites', art: 'linear-gradient(140deg,#ff6b6b,#7a2d6b)' },
      { title: 'Focus', sub: 'Calm instrumentals', art: 'linear-gradient(140deg,#7dd3c0,#2b5876)' },
      { title: 'Discover Mix', sub: 'New for you', art: 'linear-gradient(140deg,#ffd36e,#c2410c)' },
      { title: 'Late Night', sub: 'Slow and low', art: 'linear-gradient(140deg,#8b7cf6,#1e1b4b)' },
      { title: 'Replay Mix', sub: 'On repeat', art: 'linear-gradient(140deg,#f9a8d4,#9d174d)' },
    ],
  },

  // Wallpapers that ship with the launcher (files in the repo's wallpapers/
  // folder; the artifact page sets WALLPAPER_BASE for its own layout). Photos
  // added from a phone are appended at start-up by bridge.js.
  wallpaperBase: window.WALLPAPER_BASE || '../wallpapers/',
  wallpaperFiles: [
    ['sydney-harbour-bridge.png', 'Harbour bridge'],
    ['basic-aurora.jpg', 'Aurora'],
    ['basic-dusk.jpg', 'Dusk'],
    ['basic-ocean.jpg', 'Ocean'],
    ['basic-ember.jpg', 'Ember'],
    ['basic-forest.jpg', 'Forest'],
    ['basic-mist.jpg', 'Mist'],
  ],
  wallpapers: [], // filled in just below the object: {name, label, url, custom}

  // Sample weather for the browser preview. On the TV the real weather comes
  // from Open-Meteo for the TV's location (or the town set in Settings), see
  // loadWeather() in app.js.
  weather: {
    town: 'Cardiff',
    tempC: 12,
    condition: 'Partly cloudy',
    high: 14,
    low: 8,
    icon: 'wPartly',
    palette: ['#9fd3ff', '#3f86d9', '#1d4c9c'],
    extra: { feels: 10, wind: 9, humidity: 72, hours: [{ at: '14:00', temp: 13, rain: 5 }, { at: '16:00', temp: 14, rain: 10 }, { at: '18:00', temp: 12, rain: 20 }, { at: '20:00', temp: 10, rain: 35 }, { at: '22:00', temp: 9, rain: 20 }, { at: '00:00', temp: 8, rain: 10 }] },
  },

  hero: {
    app: 'BBC iPlayer',
    appId: 'iplayer',
    appColor: '#ff4fa3',
    title: 'The Coastline',
    subtitle: 'Series 2, episode 4',
    left: '23 min left',
    progress: 62,
    art: 'linear-gradient(130deg,#1e6a7a 0%,#24315e 50%,#4a1f4e 100%)',
  },

  // Fallback for Continue watching when apps don't share Watch Next data:
  // the most recently used apps (UsageStatsManager on device).
  recentApps: ['iplayer', 'prime'],

  continueWatching: [
    { app: 'Prime Video', appId: 'prime', title: 'Northbound', meta: '1h 12m left', progress: 38, art: 'linear-gradient(150deg,#3b5f8a,#121a2c)' },
    { app: 'ITVX', appId: 'itvx', title: 'Kitchen Nights', meta: '8 min left', progress: 84, art: 'linear-gradient(150deg,#b0743a,#3a1f14)' },
  ],

  // Search catalogue. Only titles on installed apps are shown.
  // On device: TMDB search + its "watch providers" data (from JustWatch, per
  // country: free, subscription, rent, buy; credit JustWatch), with prices
  // from a pricing source such as Watchmode once its UK rent/buy prices are
  // confirmed. Anything not found hands over to Google TV's own search.
  // offer.kind: 'free' (free on the app), 'subscription' (included in a
  // subscription you already have), 'rent' or 'buy' (price shown on the card).
  catalogue: [
    { title: 'The Coastline', app: 'iplayer', meta: 'Drama, 2 series', offer: { kind: 'free' }, art: 'linear-gradient(130deg,#1e6a7a,#24315e 55%,#4a1f4e)' },
    { title: 'Kitchen Nights', app: 'itvx', meta: 'Reality, 1 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#d08a45,#3a1f14)' },
    { title: 'Harbour Lights', app: 'c4', meta: 'Documentary, 3 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#3f8f7a,#0f2a2a)' },
    { title: 'Fen Country', app: 'my5', meta: 'Crime, 1 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#5a76b8,#1a1f3a)' },
    { title: 'Northbound', app: 'prime', meta: 'Thriller, included with Prime', offer: { kind: 'subscription' }, art: 'linear-gradient(150deg,#3b5f8a,#121a2c)' },
    { title: 'Glass Meridian', app: 'prime', meta: 'Sci-fi film, 2026', offer: { kind: 'rent', price: '£3.49' }, art: 'linear-gradient(150deg,#7b6cf6,#1d1846)' },
    { title: 'Cold Front', app: 'playmovies', meta: 'Action film, 2025', offer: { kind: 'buy', price: '£7.99' }, art: 'linear-gradient(150deg,#8fb3c9,#1c2a36)' },
    { title: 'The Long Field', app: 'playmovies', meta: 'Drama film, 2026', offer: { kind: 'rent', price: '£4.99' }, art: 'linear-gradient(150deg,#c9a24f,#3a2a10)' },
    { title: 'Saltwater', app: 'prime', meta: 'Drama film, 2024', offer: { kind: 'buy', price: '£9.99' }, art: 'linear-gradient(150deg,#4fa3c9,#0e2433)' },
    { title: 'Iron Tide', app: 'playmovies', meta: 'War film, 2025', offer: { kind: 'rent', price: '£2.49' }, art: 'linear-gradient(150deg,#a3584a,#2a1210)' },
    // Not installed, so filtered out of search.
    { title: 'Moonfall Street', app: 'netflix', meta: 'Drama', offer: { kind: 'subscription' }, art: 'linear-gradient(150deg,#555,#111)' },
  ],

  // Room: lights, TV backlights and soundbar. All state here is simulated.
  // On device:
  // - Lights and backlights are Govee. Two routes, used together:
  //   * Govee LAN API (fast, local, no account). Turn on "LAN Control" for each
  //     device in the Govee Home app. Discover with a UDP multicast to
  //     239.255.255.250:4001 ({"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}});
  //     devices answer on port 4002 with ip and sku. Control by sending JSON to
  //     <device ip>:4003: "turn" {value:0|1}, "brightness" {value:1-100},
  //     "colorwc" {color:{r,g,b}, colorTemInKelvin}, "devStatus". One colour per device.
  //   * Govee cloud API (API key from the Govee Home app) for what LAN can't do:
  //     multi-colour segments on the backlights (the 3-colour scenes) and
  //     switching DreamView (picture sync) on or off. Not every model supports
  //     every capability: check each device's capability list.
  //   "Match picture" turns DreamView back on.
  //   TV backlights: Govee TV Backlight 3 Lite, H6097 (40-50", RGBICW strip with
  //   a camera for picture sync; also supports Matter). Not yet confirmed on
  //   Govee's LAN API model list: check for "LAN Control" in its settings in the
  //   Govee Home app. If it isn't there, use the cloud API, or Matter through
  //   Google Home, for colours and on/off.
  // - Soundbar on HDMI ARC: power and volume go over HDMI-CEC. On Android TV the
  //   launcher adjusts system volume (AudioManager) and the TV forwards it to the
  //   soundbar. Sound modes have no CEC command, so they stay on the D50 remote.
  //   Its Bluetooth is for playing audio into it, not for control.
  smartHome: {
    backlights: {
      name: 'TV backlight',
      model: 'H6097',
      start: 'aurora',
      scenes: [
        { id: 'aurora', name: 'Aurora', colors: ['#2bd47d', '#14b8a6', '#0e5f8a'] },
        { id: 'sunset', name: 'Sunset', colors: ['#ff7a45', '#d6336c', '#5b2a86'] },
        { id: 'ocean', name: 'Ocean', colors: ['#38bdf8', '#2563eb', '#0e7490'] },
        { id: 'neon', name: 'Neon', colors: ['#f472b6', '#a855f7', '#22d3ee'] },
        { id: 'ember', name: 'Ember', colors: ['#f59e0b', '#dc2626', '#7c2d12'] },
        { id: 'warm', name: 'Warm white', colors: ['#ffd9a8', '#ffb36b', '#c27a3a'] },
      ],
    },
    provider: 'Govee',
    lights: [
      { id: 'ceiling', name: 'Ceiling light', on: false },
      { id: 'floor', name: 'Floor lamp', on: true },
      { id: 'desk', name: 'Desk lamp', on: true },
    ],
    // One-press room scenes: what every room light does, and the backlight scene.
    scenes: [
      { id: 'movie', name: 'Movie', lights: { on: false }, backlight: 'ocean' },
      { id: 'gaming', name: 'Gaming', lights: { on: true, brightness: 25, kelvin: 3000, ceiling: false }, backlight: 'sync' },
      { id: 'relax', name: 'Relax', lights: { on: true, brightness: 55, kelvin: 2400 }, backlight: 'ember' },
      { id: 'bright', name: 'Bright', lights: { on: true, brightness: 100, kelvin: 4000 }, backlight: 'warm' },
      { id: 'night', name: 'Good night', lights: { on: false }, backlight: 'off' },
      { id: 'off', name: 'All off', lights: { on: false }, backlight: 'off' },
    ],
    soundbar: {
      name: 'Ultimea Poseidon D50',
      connection: 'HDMI ARC',
      volume: 18,
      volumeMax: 40,
    },
  },

  // Apps to switch off, agreed one by one (see debloat/README.md). Each entry
  // is {pkg, reason}. Settings > Clean up apps lists them and opens each app's
  // page in the TV's Settings, where you press Disable (Enable undoes it).
  // Left empty until the list has been reviewed.
  cleanup: [],

  // Games tab switches the TV to the Xbox's HDMI input.
  // On device: find the input via TvInputManager.getTvInputList() (TYPE_HDMI,
  // matching port), then start ACTION_VIEW on
  // TvContract.buildChannelUriForPassthroughInput(inputId). HDMI-CEC wakes the
  // Xbox. The input id for "HDMI 2" is device-specific: confirm on the TV.
  games: {
    device: 'Xbox',
    hdmiPort: 2,
    autoSwitch: true,
    countdownSec: 3,
  },
};

LAUNCHER_DATA.wallpapers = LAUNCHER_DATA.wallpaperFiles.map(([file, label]) => ({
  name: file,
  label,
  url: `${LAUNCHER_DATA.wallpaperBase}${file}`,
  custom: false,
}));
