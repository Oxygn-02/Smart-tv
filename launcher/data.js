// Placeholder data for the prototype. On device these come from:
// - nowPlaying: MediaSessionManager.getActiveSessions()
// - continueWatching: TvContractCompat.WatchNextPrograms (fallback: UsageStatsManager)
// - weather: Open-Meteo (location set in launcher settings)
// - apps: PackageManager (real icons and banners, never hand-drawn)
const LAUNCHER_DATA = {
  nav: [
    { id: 'home', label: 'Home' },
    { id: 'search', label: 'Search' },
    { id: 'music', label: 'Music' },
    { id: 'live', label: 'Live TV' },
    { id: 'apps', label: 'All apps' },
    { id: 'games', label: 'Games' },
  ],

  nowPlaying: {
    source: 'YouTube Music',
    title: 'Late Night Static',
    artist: 'Neon Harbour',
    durationSec: 222,
    positionSec: 83,
    art: 'linear-gradient(140deg,#e8735a 0%,#8b3a7a 55%,#2c1d4f 100%)',
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
    appColor: '#ff4fa3',
    title: 'The Coastline',
    subtitle: 'Series 2 · Episode 4 · 23 min left',
    progress: 62,
    art: 'linear-gradient(130deg,#1e6a7a 0%,#24315e 50%,#4a1f4e 100%)',
  },

  continueWatching: [
    {
      app: 'Prime Video',
      title: 'Northbound',
      meta: '1h 12m left',
      progress: 38,
      art: 'linear-gradient(150deg,#3b5f8a,#121a2c)',
    },
    {
      app: 'ITVX',
      title: 'Kitchen Nights',
      meta: 'S1 · E2 · 8 min left',
      progress: 84,
      art: 'linear-gradient(150deg,#b0743a,#3a1f14)',
    },
  ],

  // Brand colours are placeholders until real app icons are read from the device.
  apps: [
    { id: 'youtube', name: 'YouTube', color: '#ff3b3b' },
    { id: 'iplayer', name: 'iPlayer', color: '#ff4fa3' },
    { id: 'itvx', name: 'ITVX', color: '#e6c341' },
    { id: 'c4', name: 'Channel 4', color: '#47c98f' },
    { id: 'my5', name: 'My5', color: '#4f8fff' },
    { id: 'prime', name: 'Prime Video', color: '#38b6f0' },
    { id: 'ytmusic', name: 'YT Music', color: '#ff5a5a' },
  ],
};
