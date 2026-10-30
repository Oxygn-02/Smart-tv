// Placeholder data for the prototype. On device these come from:
// - apps: PackageManager (getApplicationIcon / getApplicationBanner)
// - music: MediaSessionManager.getActiveSessions() (YouTube Music session + queue)
// - continueWatching: TvContractCompat.WatchNextPrograms (fallback: UsageStatsManager)
// - search: each installed app's Android TV global-search provider, plus a
//   price lookup for titles that are only available to rent or buy
// - liveTv: TvContract channels/programs from the broadcaster apps' live inputs
// - weather: Open-Meteo (location set in Settings)
// Show titles, tracks and programmes are made up; channel names are real.
const LAUNCHER_DATA = {
  nav: [
    { id: 'home', label: 'Home' },
    { id: 'search', label: 'Search' },
    { id: 'music', label: 'Music' },
    { id: 'live', label: 'Live TV' },
    { id: 'apps', label: 'All apps' },
    { id: 'games', label: 'Games' },
  ],

  // Installed apps, in "All apps" order. `pinned` apps make the Home row.
  // `logo` names a real logo in icons.js; `mark` is a lettermark used until
  // the device supplies the real icon.
  apps: [
    { id: 'youtube', name: 'YouTube', color: '#ff3b3b', logo: 'youtube', pinned: true },
    { id: 'iplayer', name: 'BBC iPlayer', short: 'iPlayer', color: '#ff4fa3', mark: 'iP', pinned: true },
    { id: 'itvx', name: 'ITVX', color: '#e6c341', logo: 'itvx', pinned: true },
    { id: 'c4', name: 'Channel 4', color: '#47c98f', logo: 'channel4', pinned: true },
    { id: 'my5', name: 'My5', color: '#4f8fff', mark: '5', pinned: true },
    { id: 'prime', name: 'Prime Video', color: '#38b6f0', logo: 'primevideo', pinned: true },
    { id: 'ytmusic', name: 'YouTube Music', short: 'YT Music', color: '#ff5a5a', logo: 'youtubemusic', pinned: true },
    { id: 'playstore', name: 'Google Play Store', short: 'Play Store', color: '#5bb974', logo: 'googleplay' },
    { id: 'playmovies', name: 'Google TV', color: '#8ab4f8', mark: 'TV' },
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

  weather: {
    town: '[Your town]',
    tempC: 12,
    condition: 'Partly cloudy',
    high: 14,
    low: 8,
  },

  hero: {
    app: 'BBC iPlayer',
    appId: 'iplayer',
    appColor: '#ff4fa3',
    title: 'The Coastline',
    subtitle: 'Series 2 · Episode 4 · 23 min left',
    progress: 62,
    art: 'linear-gradient(130deg,#1e6a7a 0%,#24315e 50%,#4a1f4e 100%)',
  },

  continueWatching: [
    { app: 'Prime Video', appId: 'prime', title: 'Northbound', meta: '1h 12m left', progress: 38, art: 'linear-gradient(150deg,#3b5f8a,#121a2c)' },
    { app: 'ITVX', appId: 'itvx', title: 'Kitchen Nights', meta: 'S1 · E2 · 8 min left', progress: 84, art: 'linear-gradient(150deg,#b0743a,#3a1f14)' },
  ],

  // Search catalogue. Only titles on installed apps are shown.
  // offer.kind: 'free' (free on the app), 'subscription' (included in a
  // subscription you already have), 'rent' or 'buy' (price shown on the card).
  catalogue: [
    { title: 'The Coastline', app: 'iplayer', meta: 'Drama · 2 series', offer: { kind: 'free' }, art: 'linear-gradient(130deg,#1e6a7a,#24315e 55%,#4a1f4e)' },
    { title: 'Kitchen Nights', app: 'itvx', meta: 'Reality · 1 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#d08a45,#3a1f14)' },
    { title: 'Harbour Lights', app: 'c4', meta: 'Documentary · 3 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#3f8f7a,#0f2a2a)' },
    { title: 'Fen Country', app: 'my5', meta: 'Crime · 1 series', offer: { kind: 'free' }, art: 'linear-gradient(150deg,#5a76b8,#1a1f3a)' },
    { title: 'Northbound', app: 'prime', meta: 'Thriller · Included with Prime', offer: { kind: 'subscription' }, art: 'linear-gradient(150deg,#3b5f8a,#121a2c)' },
    { title: 'Glass Meridian', app: 'prime', meta: 'Sci-fi · Film · 2026', offer: { kind: 'rent', price: '£3.49' }, art: 'linear-gradient(150deg,#7b6cf6,#1d1846)' },
    { title: 'Cold Front', app: 'playmovies', meta: 'Action · Film · 2025', offer: { kind: 'buy', price: '£7.99' }, art: 'linear-gradient(150deg,#8fb3c9,#1c2a36)' },
    { title: 'The Long Field', app: 'playmovies', meta: 'Drama · Film · 2026', offer: { kind: 'rent', price: '£4.99' }, art: 'linear-gradient(150deg,#c9a24f,#3a2a10)' },
    { title: 'Saltwater', app: 'prime', meta: 'Drama · Film · 2024', offer: { kind: 'buy', price: '£9.99' }, art: 'linear-gradient(150deg,#4fa3c9,#0e2433)' },
    { title: 'Iron Tide', app: 'playmovies', meta: 'War · Film · 2025', offer: { kind: 'rent', price: '£2.49' }, art: 'linear-gradient(150deg,#a3584a,#2a1210)' },
    // Not installed, so filtered out of search.
    { title: 'Moonfall Street', app: 'netflix', meta: 'Drama', offer: { kind: 'subscription' }, art: 'linear-gradient(150deg,#555,#111)' },
  ],

  // Live TV. Real Freeview channels; programmes are placeholders.
  // Opening a channel hands off to the broadcaster's app (app id).
  liveTv: [
    { number: '001', name: 'BBC One', app: 'iplayer', slotMin: 30, now: 'Coastal Kitchens', next: 'The Coastline' },
    { number: '002', name: 'BBC Two', app: 'iplayer', slotMin: 60, now: 'Wild Islands', next: 'Gardeners’ Hour' },
    { number: '003', name: 'ITV1', app: 'itvx', slotMin: 30, now: 'Afternoon Quiz', next: 'Regional News' },
    { number: '004', name: 'Channel 4', app: 'c4', slotMin: 60, now: 'Harbour Lights', next: 'House Hunters UK' },
    { number: '005', name: 'Channel 5', app: 'my5', slotMin: 30, now: 'Fen Country', next: 'Roads Patrol' },
    { number: '006', name: 'ITV2', app: 'itvx', slotMin: 30, now: 'Kitchen Nights', next: 'Sun Seekers' },
  ],

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
