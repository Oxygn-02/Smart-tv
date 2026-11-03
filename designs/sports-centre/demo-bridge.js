// A pretend TV for the browser preview (artifact.html only; never in the app).
// It stands in for the Android side (window.Android) so the launcher runs its
// real TV code: installed apps, now playing, lights, Continue watching, film
// search with where-to-watch and prices, inputs, clean-up, updates and
// Diagnostics. Everything here is sample data; nothing leaves the browser.
(() => {
  const emit = (name, data, ms = 0) => setTimeout(() => window.onNative && window.onNative(name, data), ms);

  // A small "the TV would do this" note, since there is no real app to open.
  function note(text) {
    let el = document.getElementById('demo-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-note';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99;padding:10px 18px;border-radius:14px;'
        + 'background:rgba(16,17,23,.92);color:#f2f2f6;font:500 15px/1.3 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);pointer-events:none;transition:opacity .3s';
      document.body.append(el);
    }
    el.textContent = `Demo: ${text}`;
    el.style.opacity = '1';
    clearTimeout(note.t);
    note.t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }

  // ---------- Pictures drawn here, so the preview needs no image hosts ----------
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hsl = (h, s, l) => `hsl(${h % 360},${s}%,${l}%)`;
  const enc = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  const xml = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function picture(title, wide, hue) {
    const h = hue ?? hash(title) % 360;
    const [w, ht] = wide ? [780, 440] : [342, 513];
    const words = title.split(' ');
    const lines = [];
    words.forEach((wd) => { if (lines.length && (lines[lines.length - 1] + ' ' + wd).length < (wide ? 22 : 12)) lines[lines.length - 1] += ' ' + wd; else lines.push(wd); });
    const size = wide ? 46 : 40;
    // Wide stills carry no title (the card shows it); posters do.
    const text = wide ? '' : lines.slice(0, 3).map((l, i) => `<text x="${wide ? 44 : 28}" y="${ht - 40 - (lines.length - 1 - i) * (size + 6)}" font-family="Inter,Arial,sans-serif" font-size="${size}" font-weight="700" fill="#fff" fill-opacity=".92">${xml(l)}</text>`).join('');
    return enc(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(h, 70, 52)}"/><stop offset=".55" stop-color="${hsl(h + 40, 60, 30)}"/><stop offset="1" stop-color="${hsl(h + 80, 55, 12)}"/></linearGradient><radialGradient id="r" cx=".75" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>${text}</svg>`);
  }
  const cover = (title, hue) => enc(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue, 80, 60)}"/><stop offset="1" stop-color="${hsl(hue + 60, 70, 25)}"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><circle cx="230" cy="90" r="70" fill="#fff" fill-opacity=".18"/><text x="24" y="292" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="700" fill="#fff">${xml(title)}</text></svg>`);

  // ---------- Apps on the pretend TV ----------
  const APPS = [
    ['com.google.android.youtube.tv', 'YouTube'], ['uk.co.freeview.bbc', 'BBC iPlayer'], ['uk.co.freeview.itv', 'ITVX'],
    ['uk.co.freeview.ch4_vod', 'Channel 4'], ['uk.co.freeview.ch5', 'My5'], ['com.amazon.amazonvideo.livingroom', 'Prime Video'],
    ['com.disney.disneyplus', 'Disney+'], ['com.crunchyroll.crunchyroid', 'Crunchyroll'], ['com.google.android.youtube.tvmusic', 'YouTube Music'],
    ['com.android.vending', 'Google Play Store'], ['com.google.android.videos', 'Google TV'], ['com.netflix.ninja', 'Netflix'],
    ['com.apple.atve.androidtv.appletv', 'Apple TV'], ['com.spotify.tv.android', 'Spotify'], ['com.esaba.downloader', 'Downloader'],
  ];
  const label = (pkg) => (APPS.find((a) => a[0] === pkg) || [pkg, pkg])[1];

  // ---------- Now playing: a short pretend playlist ----------
  const SONGS = [
    { title: 'Blue Hour', artist: 'Iris Vale', dur: 214000, hue: 210, colors: ['#8fc7ff', '#3d6fb8', '#13284a'] },
    { title: 'Neon Rain', artist: 'Kite Runner', dur: 187000, hue: 300, colors: ['#ff9be6', '#a04fc0', '#2c1340'] },
    { title: 'Golden Coast', artist: 'Sunday Club', dur: 241000, hue: 30, colors: ['#ffd27a', '#d0782e', '#4a2410'] },
  ];
  const np = { i: 0, pos: 30000, playing: true, at: Date.now(), source: 'YouTube Music', pkg: 'com.google.android.youtube.tvmusic' };
  const pos = () => Math.min(SONGS[np.i].dur, np.pos + (np.playing ? Date.now() - np.at : 0));
  const settle = () => { np.pos = pos(); np.at = Date.now(); };
  function nextSong(d) { np.i = (np.i + d + SONGS.length) % SONGS.length; np.pos = 0; np.at = Date.now(); np.playing = true; }

  // ---------- Lights ----------
  const dev = (id, sku, name, extra) => Object.assign({ id, sku, name, light: true, on: false, color: true, white: true, brightness: true, dream: false }, extra);
  const govee = { hasKey: true, connected: true, error: '', devices: [dev('AA', 'H6097', 'TV Backlight 3 Lite', { dream: true, on: true }), dev('BB', 'H6072', 'Floor lamp', { on: true }), dev('CC', 'H6008', 'Desk lamp'), dev('DD', 'H6008', 'Ceiling light')] };
  const light = (id) => govee.devices.find((d) => d.id === id);
  let sleepAt = 0;

  // ---------- Films and series (sample data, UK services) ----------
  const P = (n) => ({ provider_name: n, logo_path: null });
  const T = [
    [1, 'movie', 'Dune: Part Two', 2024, 166, 8.1, 'Paul Atreides unites with the Fremen while on a path of revenge against those who destroyed his family.', ['Science Fiction', 'Adventure'], { flatrate: ['Netflix'], rent: ['Apple TV', 'Amazon Video'], buy: ['Apple TV'] }],
    [2, 'movie', 'Oppenheimer', 2023, 180, 8.1, 'The story of J. Robert Oppenheimer and the making of the atomic bomb.', ['Drama', 'History'], { flatrate: ['Prime Video'], rent: ['Apple TV'], buy: ['Apple TV', 'Amazon Video'] }],
    [3, 'tv', 'The Traitors', 2022, 60, 8.0, 'Contestants play a game of deception in a Scottish castle, where some are secretly Traitors.', ['Reality'], { free: ['BBC iPlayer'] }],
    [4, 'tv', 'Slow Horses', 2022, 50, 8.2, 'A team of MI5 agents who have been sent to the service\'s dumping ground for failures.', ['Drama', 'Crime'], { flatrate: ['Apple TV Plus'] }],
    [5, 'movie', 'Inside Out 2', 2024, 96, 7.6, 'Riley\'s mind headquarters is suddenly demolished to make room for some new emotions.', ['Animation', 'Family'], { flatrate: ['Disney Plus'], rent: ['Apple TV'] }],
    [6, 'movie', 'Wicked', 2024, 160, 7.4, 'Elphaba and Glinda forge an unlikely friendship in the Land of Oz.', ['Fantasy', 'Musical'], { rent: ['Apple TV', 'Amazon Video', 'Google Play Movies'], buy: ['Apple TV'] }],
    [7, 'tv', 'Gavin & Stacey', 2007, 30, 7.9, 'A long-distance romance between Gavin from Essex and Stacey from Barry.', ['Comedy'], { free: ['BBC iPlayer'], flatrate: ['Netflix'] }],
    [8, 'tv', 'Baby Reindeer', 2024, 35, 7.6, 'A struggling comedian\'s encounter with a woman at work spirals.', ['Drama'], { flatrate: ['Netflix'] }],
    [9, 'tv', 'The Bear', 2022, 30, 8.2, 'A young chef returns to Chicago to run his family\'s sandwich shop.', ['Drama', 'Comedy'], { flatrate: ['Disney Plus'] }],
    [10, 'tv', 'Severance', 2022, 50, 8.4, 'Office workers whose memories are surgically divided between work and personal lives.', ['Drama', 'Mystery'], { flatrate: ['Apple TV Plus'] }],
    [11, 'movie', 'Paddington in Peru', 2024, 106, 7.2, 'Paddington travels to Peru to visit his beloved Aunt Lucy.', ['Family', 'Comedy'], { rent: ['Apple TV', 'Amazon Video'], buy: ['Apple TV'] }],
    [12, 'movie', 'Top Gun: Maverick', 2022, 131, 8.2, 'After thirty years, Maverick is still pushing the envelope as a top naval aviator.', ['Action', 'Drama'], { flatrate: ['Prime Video'], free: ['ITVX'], rent: ['Apple TV'] }],
    [13, 'tv', 'Doctor Who', 2023, 50, 7.4, 'The Doctor, a Time Lord, travels through time and space.', ['Science Fiction'], { free: ['BBC iPlayer'], flatrate: ['Disney Plus'] }],
    [14, 'tv', 'Bluey', 2018, 7, 8.8, 'A Blue Heeler puppy and her family turn everyday life into play.', ['Animation', 'Kids'], { free: ['BBC iPlayer'], flatrate: ['Disney Plus'] }],
    [15, 'movie', 'Gladiator II', 2024, 148, 6.8, 'Lucius is forced to enter the Colosseum after his home is conquered.', ['Action', 'History'], { flatrate: ['Prime Video'], rent: ['Apple TV'], buy: ['Apple TV'] }],
    [16, 'tv', 'Taskmaster', 2015, 47, 8.4, 'Comedians attempt a series of absurd tasks set by the Taskmaster.', ['Comedy'], { free: ['Channel 4'] }],
  ].map(([id, type, title, year, runtime, vote, overview, genres, prov]) => ({ id, type, title, year, runtime, vote, overview, genres, prov }));
  const PRICES = { 'Apple TV': { rent: 4.99, buy: 13.99 }, 'Amazon Video': { rent: 4.49, buy: 12.99 }, 'Google Play Movies': { rent: 4.49, buy: 11.99 } };

  const asTmdb = (t) => ({
    id: t.id, media_type: t.type, [t.type === 'tv' ? 'name' : 'title']: t.title,
    [t.type === 'tv' ? 'first_air_date' : 'release_date']: `${t.year}-05-01`,
    vote_average: t.vote, overview: t.overview, poster_path: picture(t.title, false), backdrop_path: picture(t.title, true),
  });
  function tmdbAnswer(path, q) {
    if (path === 'search/multi') {
      const words = String(q.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      return { results: T.filter((t) => words.every((w) => t.title.toLowerCase().includes(w))).map(asTmdb) };
    }
    const disc = /^discover\/(movie|tv)$/.exec(path);
    if (disc) return { results: T.filter((t) => t.type === disc[1]).sort((a, b) => b.vote - a.vote).map(asTmdb) };
    const m = /^(movie|tv)\/(\d+)(\/watch\/providers)?$/.exec(path);
    const t = m && T.find((x) => x.id === Number(m[2]));
    if (!t) return null;
    if (m[3]) {
      const gb = {};
      Object.entries(t.prov).forEach(([k, names]) => { gb[k] = names.map(P); });
      return { results: { GB: gb } };
    }
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const eps = t.type === 'tv' ? { last_episode_to_air: { air_date: day(t.id % 3 ? -9 : 0), season_number: 3, episode_number: 4 + (t.id % 4), name: 'Episode' }, next_episode_to_air: t.id % 2 ? { air_date: day(5), season_number: 3, episode_number: 6 + (t.id % 4) } : null } : {};
    return { ...asTmdb(t), ...eps, runtime: t.type === 'movie' ? t.runtime : undefined, episode_run_time: t.type === 'tv' ? [t.runtime] : undefined, number_of_seasons: t.type === 'tv' ? 3 : undefined, genres: t.genres.map((name) => ({ name })), videos: { results: [] } };
  }
  function pricesAnswer(path, q) {
    if (path === 'search/') return { title_results: [{ id: 1000 + Number(q.search_value) }] };
    const m = /^title\/(\d+)\/sources\/$/.exec(path);
    const t = m && T.find((x) => x.id === Number(m[1]) - 1000);
    if (!t) return [];
    const out = [];
    ['rent', 'buy'].forEach((type) => (t.prov[type] || []).forEach((name) => { if (PRICES[name]) out.push({ name: name === 'Amazon Video' ? 'Prime Video' : name, type, price: PRICES[name][type] }); }));
    return out;
  }


  // ---------- NBA (sample data shaped like ESPN's public feed) ----------
  const TEAMS = [
    ['ATL', 'Atlanta Hawks', 'Hawks', 'e03a3e', 'E'], ['BOS', 'Boston Celtics', 'Celtics', '008348', 'E'], ['BKN', 'Brooklyn Nets', 'Nets', '000000', 'E'],
    ['CHA', 'Charlotte Hornets', 'Hornets', '1d1160', 'E'], ['CHI', 'Chicago Bulls', 'Bulls', 'ce1141', 'E'], ['CLE', 'Cleveland Cavaliers', 'Cavaliers', '860038', 'E'],
    ['DET', 'Detroit Pistons', 'Pistons', 'c8102e', 'E'], ['IND', 'Indiana Pacers', 'Pacers', '002d62', 'E'], ['MIA', 'Miami Heat', 'Heat', '98002e', 'E'],
    ['MIL', 'Milwaukee Bucks', 'Bucks', '00471b', 'E'], ['NY', 'New York Knicks', 'Knicks', 'f58426', 'E'], ['ORL', 'Orlando Magic', 'Magic', '0077c0', 'E'],
    ['PHI', 'Philadelphia 76ers', '76ers', '006bb6', 'E'], ['TOR', 'Toronto Raptors', 'Raptors', 'ce1141', 'E'], ['WSH', 'Washington Wizards', 'Wizards', '002b5c', 'E'],
    ['DAL', 'Dallas Mavericks', 'Mavericks', '00538c', 'W'], ['DEN', 'Denver Nuggets', 'Nuggets', '0e2240', 'W'], ['GS', 'Golden State Warriors', 'Warriors', '1d428a', 'W'],
    ['HOU', 'Houston Rockets', 'Rockets', 'ce1141', 'W'], ['LAC', 'LA Clippers', 'Clippers', 'c8102e', 'W'], ['LAL', 'Los Angeles Lakers', 'Lakers', '552583', 'W'],
    ['MEM', 'Memphis Grizzlies', 'Grizzlies', '5d76a9', 'W'], ['MIN', 'Minnesota Timberwolves', 'Timberwolves', '0c2340', 'W'], ['NO', 'New Orleans Pelicans', 'Pelicans', '0c2340', 'W'],
    ['OKC', 'Oklahoma City Thunder', 'Thunder', '007ac1', 'W'], ['PHX', 'Phoenix Suns', 'Suns', '1d1160', 'W'], ['POR', 'Portland Trail Blazers', 'Trail Blazers', 'e03a3e', 'W'],
    ['SAC', 'Sacramento Kings', 'Kings', '5a2d81', 'W'], ['SA', 'San Antonio Spurs', 'Spurs', 'c4ced4', 'W'], ['UTAH', 'Utah Jazz', 'Jazz', '002b5c', 'W'],
  ].map(([abbr, name, short, color, conf], i) => ({ id: String(i + 1), abbr, name, short, color, conf }));
  const teamBy = (abbr) => TEAMS.find((t) => t.abbr === abbr);
  // ESPN's own logo images, as its feed gives them on the TV
  const logo = (t) => `https://a.espncdn.com/i/teamlogos/nba/500/${t.abbr.toLowerCase()}.png`;
  const espnTeam = (t) => ({ id: t.id, abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, color: t.color, logo: logo(t) });
  const record = (t) => { const w = 3 + (hash(t.abbr) % 9); return `${w}-${10 - w}`; };

  const FIXTURES = [
    ['LAL', 'BOS', -1, 'post', 118, 112], ['NY', 'MIA', -1, 'post', 104, 99], ['GS', 'DEN', 0, 'in', 87, 91, 3, '4:12'], ['OKC', 'DAL', 0, 'in', 52, 49, 2, '1:05'],
    ['PHX', 'MIL', 0, 'pre'], ['CLE', 'ORL', 0, 'pre'], ['BOS', 'PHI', 1, 'pre'], ['LAL', 'SAC', 1, 'pre'], ['MIN', 'HOU', 1, 'pre'],
    ['DEN', 'LAL', 2, 'pre'], ['TOR', 'CHI', 2, 'pre'], ['BOS', 'NY', 3, 'pre'], ['GS', 'LAC', 3, 'pre'], ['MEM', 'SA', 4, 'pre'],
    ['LAL', 'GS', 5, 'pre'], ['ATL', 'BOS', 5, 'pre'], ['IND', 'DET', 6, 'pre'], ['POR', 'UTAH', 6, 'pre'],
  ];
  function scoreboard() {
    const start = new Date(); start.setUTCHours(0, 30, 0, 0);
    return { events: FIXTURES.map(([a, h, day, st, as, hs, period, clock], i) => {
      const at = new Date(start.getTime() + day * 86400000 + (i % 3) * 3600000 + (day === 0 && st === 'pre' ? 20 * 3600000 : 0));
      const away = teamBy(a); const home = teamBy(h);
      const detail = st === 'post' ? 'Final' : st === 'in' ? `${clock} - ${period === 2 ? '2nd' : '3rd'} Qtr` : at.toUTCString();
      return {
        id: String(4000 + i), date: at.toISOString(), name: `${away.name} at ${home.name}`, shortName: `${a} @ ${h}`,
        status: { displayClock: clock || '0:00', period: period || 0, type: { state: st, completed: st === 'post', shortDetail: detail, detail } },
        competitions: [{
          venue: { fullName: `${home.short} Arena` }, broadcasts: [{ names: [i % 2 ? 'NBA TV' : 'ESPN'] }],
          competitors: [
            { homeAway: 'home', score: hs != null ? String(hs) : '', team: espnTeam(home), records: [{ summary: record(home) }] },
            { homeAway: 'away', score: as != null ? String(as) : '', team: espnTeam(away), records: [{ summary: record(away) }] },
          ],
        }],
      };
    }) };
  }
  function standings() {
    const conf = (c, name) => ({ name, abbreviation: c === 'E' ? 'East' : 'West', standings: { entries: TEAMS.filter((t) => t.conf === c)
      .map((t) => { const w = 3 + (hash(t.abbr + 'w') % 10); return { t, w, l: 13 - w }; })
      .sort((x, y) => y.w - x.w)
      .map(({ t, w, l }, i, all) => ({ team: { abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, logos: [{ href: logo(t) }] },
        stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'winPercent', value: w / 13 }, { name: 'gamesBehind', displayValue: i ? String((all[0].w - w)) : '-' },
          { name: 'streak', displayValue: (hash(t.abbr) % 2 ? 'W' : 'L') + (1 + (hash(t.abbr) % 4)) }, { name: 'playoffSeed', value: i + 1 }] })) } });
    return { children: [conf('E', 'Eastern Conference'), conf('W', 'Western Conference')] };
  }
  const NEWS = [
    ['Media', 'Highlights: Lakers hold off Celtics in Boston', 'LeBron James scored 31 and the Lakers survived a late Boston run to win 118-112.', 'LAL'],
    ['Recap', 'Knicks grind past Heat behind Brunson\'s 34', 'Jalen Brunson scored 12 in the fourth quarter as New York pulled away from Miami.', 'NY'],
    ['Media', 'Top 10 plays of the night', 'Dunks, blocks and a buzzer-beater from Denver headline the night\'s best plays.', 'DEN'],
    ['HeadlineNews', 'Thunder extend winning streak to five', 'Oklahoma City\'s defence continues to lead the league as the Thunder roll on.', 'OKC'],
    ['Media', 'Curry hits 9 threes against the Nuggets', 'Stephen Curry put on a shooting show in San Francisco.', 'GS'],
    ['HeadlineNews', 'Injury report: who is out this week', 'The latest on the players missing games across the league.', 'BOS'],
    ['Recap', 'Cavaliers stay perfect at home', 'Cleveland improved to 6-0 at home with a comfortable win over Orlando.', 'CLE'],
  ];
  function news() {
    return { articles: NEWS.map(([type, headline, description, abbr], i) => ({
      id: 9000 + i, type, headline, description, published: new Date(Date.now() - (i + 1) * 3 * 3600000).toISOString(),
      images: [{ url: picture(headline, true, hash(abbr) % 360) }], links: { web: { href: 'https://www.espn.com/nba/' } },
    })) };
  }
  function summary(eventId) {
    const ev = scoreboard().events.find((e) => e.id === eventId);
    if (!ev) return {};
    const [home, away] = ev.competitions[0].competitors;
    const leader = (c, who, pts) => ({ team: { abbreviation: c.team.abbreviation }, leaders: [
      { name: 'points', displayName: 'Points', leaders: [{ displayValue: `${pts} PTS`, athlete: { displayName: who } }] },
      { name: 'rebounds', displayName: 'Rebounds', leaders: [{ displayValue: `${7 + (pts % 6)} REB`, athlete: { displayName: `${c.team.shortDisplayName} forward` } }] },
      { name: 'assists', displayName: 'Assists', leaders: [{ displayValue: `${5 + (pts % 5)} AST`, athlete: { displayName: `${c.team.shortDisplayName} guard` } }] },
    ] });
    const done = ev.status.type.state !== 'pre';
    return {
      header: { competitions: [{ competitors: [home, away], status: ev.status }] },
      leaders: done ? [leader(away, `${away.team.shortDisplayName} star`, 31), leader(home, `${home.team.shortDisplayName} star`, 27)] : [],
      article: ev.status.type.state === 'post' ? { headline: `${away.team.shortDisplayName} beat ${home.team.shortDisplayName} ${away.score}-${home.score}`, description: `A strong fourth quarter decided it as the ${away.team.shortDisplayName} closed out the win on the road.` } : null,
      videos: done ? [{ headline: `${away.team.shortDisplayName} vs ${home.team.shortDisplayName}: full highlights`, thumbnail: picture(`${away.team.abbreviation} ${home.team.abbreviation}`, true, hash(ev.id) % 360) }] : [],
    };
  }
  function sportsAnswer(path, q) {
    if (path === 'scoreboard') return scoreboard();
    if (path === 'standings') return standings();
    if (path === 'news') return news();
    if (path === 'teams') return { sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: espnTeam(t) })) }] }] };
    if (path === 'summary') return summary(String(q.event || ''));
    return null;
  }

  // ---------- Clean-up ----------
  const DEEP_LABEL = {"com.google.android.feedback": "Market Feedback Agent", "com.google.android.partnersetup": "Google Partner Setup", "fusion.android.tv.demo": "Shop Demo", "mediatek.factorymenu.ui": "Factory Menu", "com.mediatek.testpq": "Picture Test", "com.google.android.backdrop": "Ambient Mode", "com.mstar.android.tv.disclaimercustomization": "Disclaimer", "com.mediatek.network": "Network Monitor", "com.google.android.katniss": "Google", "com.google.android.tvlauncher": "Google TV Home", "com.google.android.tvrecommendations": "Android TV Core Services"};
  const DEEP = [
    ['com.google.android.feedback', 'safe', 'Sends feedback and crash data to Google'], ['com.google.android.partnersetup', 'safe', 'Only used during first-time setup'],
    ['fusion.android.tv.demo', 'safe', 'Shop demo mode'], ['mediatek.factorymenu.ui', 'safe', 'Technician menu'], ['com.mediatek.testpq', 'safe', 'Factory picture test'],
    ['com.google.android.backdrop', 'safe', 'Google\'s screensaver (the ambient screen replaces it)'], ['com.mstar.android.tv.disclaimercustomization', 'safe', 'First-run legal screens'],
    ['com.mediatek.network', 'careful', 'Wi-Fi monitor'], ['com.google.android.katniss', 'careful', 'The Google app: voice search and Assistant (keep if you use the voice button)'],
    ['com.google.android.tvlauncher', 'google', 'Google\'s home screen, where the ads come from'], ['com.google.android.tvrecommendations', 'google', 'Google\'s recommendations for its home screen'],
  ].map(([pkg, tier, reason]) => ({ pkg, tier, reason, label: DEEP_LABEL[pkg] || pkg, installed: true, enabled: true }));
  const tv = { home: false, adb: false, safety: false, off: [], prevHome: false, keep: 0, muted: false, vol: 18 };
  const adbDone = (message) => emit('adb', { state: 'done', message, ours: tv.off.length }, 700);
  function switchOff(list) {
    let n = 0;
    list.forEach((d) => { if (d.enabled) { d.enabled = false; tv.off.push(d.pkg); n++; } });
    return n;
  }

  window.Android = {
    __demo: true,
    // Apps
    apps: () => JSON.stringify(APPS.map(([pkg, l]) => ({ pkg, label: l, icon: '' }))),
    recentApps: () => JSON.stringify(['uk.co.freeview.bbc', 'com.amazon.amazonvideo.livingroom', 'com.google.android.youtube.tv']),
    launch: (pkg) => { note(`opens ${label(pkg)}`); return true; },
    openStore: (pkg) => { note(`opens ${label(pkg)} in the Play Store to install`); return true; },
    openAppInfo: (pkg) => note(`opens ${label(pkg)}'s page in the TV's Settings`),
    openSettings: (what) => note(`opens the TV's Settings (${what})`),
    googleSearch: (q) => note(`searches Google TV for "${q}"`),
    access: () => JSON.stringify({ nowPlaying: true, recentApps: true, location: true }),
    location: () => JSON.stringify({ lat: 51.48, lon: -3.18 }),
    appVersion: () => JSON.stringify({ code: 28, name: '0.18 (demo)' }),
    launcherReady: () => {}, wasRescued: () => false, clearRescued: () => {}, saveBackup: () => {},

    // Now playing
    nowPlaying: (known) => {
      const s = SONGS[np.i];
      const key = `${np.pkg}|${s.title}|${s.artist}`;
      const j = { key, title: s.title, artist: s.artist, durationMs: s.dur, positionMs: pos(), playing: np.playing, source: np.source, controls: true };
      if (pos() >= s.dur && np.playing) nextSong(1);
      if (known !== key) Object.assign(j, { art: cover(s.title, s.hue), colors: s.colors });
      return JSON.stringify(j);
    },
    media: (a) => {
      settle();
      if (a === 'play') np.playing = true;
      else if (a === 'pause') np.playing = false;
      else if (a === 'next') nextSong(1);
      else if (a === 'prev') nextSong(-1);
    },
    volume: (step) => { tv.vol = Math.max(0, Math.min(100, tv.vol + Math.sign(step))); },
    volumeInfo: () => JSON.stringify({ level: tv.vol, max: 100, muted: tv.muted }),
    toggleMute: () => { tv.muted = !tv.muted; },
    keepMode: () => tv.keep,
    setKeepMode: (m) => { tv.keep = m; },

    // Continue watching and For you
    watchNext: () => JSON.stringify({ ok: true, items: [
      { title: 'The Traitors', sub: 'Series 3, Episode 4', pkg: 'uk.co.freeview.bbc', uri: 'demo', poster: picture('The Traitors', true), pos: 1620000, dur: 3540000 },
      { title: 'Slow Horses', sub: 'S4 E2', pkg: 'com.apple.atve.androidtv.appletv', uri: 'demo', poster: picture('Slow Horses', true), pos: 900000, dur: 3000000 },
      { title: 'Bluey', sub: 'Keepy Uppy', pkg: 'com.disney.disneyplus', uri: 'demo', poster: picture('Bluey', true), pos: 200000, dur: 420000 },
    ] }),
    watchNextOpen: (uri, pkg) => { note(`resumes in ${label(pkg)}`); return true; },
    recommendations: () => JSON.stringify({ ok: true, items: [
      { title: 'Match of the Day', sub: '', pkg: 'uk.co.freeview.bbc', uri: 'demo', art: picture('Match of the Day', true) },
      { title: 'Mr Bates vs The Post Office', sub: '', pkg: 'uk.co.freeview.itv', uri: 'demo', art: picture('Mr Bates vs The Post Office', true) },
    ] }),
    tmdbReady: () => true,
    pricesReady: () => true,
    tmdbFetch: (id, path, query) => {
      const body = tmdbAnswer(path, JSON.parse(query || '{}'));
      emit('net', { id, ok: !!body, status: body ? 200 : 404, body: JSON.stringify(body || {}) }, 250);
    },
    sportsFetch: (id, path, query) => {
      const body = sportsAnswer(path, JSON.parse(query || '{}'));
      emit('net', { id, ok: !!body, status: body ? 200 : 404, body: JSON.stringify(body || {}) }, 300);
    },
    pricesFetch: (id, path, query) => emit('net', { id, ok: true, status: 200, body: JSON.stringify(pricesAnswer(path, JSON.parse(query || '{}'))) }, 400),

    // Lights
    goveeStatus: () => JSON.stringify(govee),
    goveeConnect: () => emit('govee', govee, 100),
    goveePower: (id, on) => { const d = light(id); if (d) d.on = !!on; },
    goveeColor: (id) => { const d = light(id); if (d) d.on = true; },
    goveeBrightness: () => {}, goveeWhite: () => {}, goveeDreamView: () => {}, goveeRead: () => {},
    goveeSleep: (min) => { sleepAt = min ? Date.now() + min * 60000 : 0; },
    goveeSleepAt: () => sleepAt,

    // Inputs and games
    inputs: () => JSON.stringify([{ id: 'hdmi1', label: 'HDMI 1', type: 1007 }, { id: 'hdmi2', label: 'Xbox', type: 1007 }, { id: 'hdmi3', label: 'HDMI 3', type: 1007 }, { id: 'tuner', label: 'Aerial TV', type: 0 }]),
    switchInput: (id) => { note(`switches the TV to ${{ hdmi1: 'HDMI 1', hdmi2: 'HDMI 2 (Xbox)', hdmi3: 'HDMI 3', tuner: 'the aerial' }[id] || id}`); return true; },
    switchToHdmi: (port) => { note(`switches the TV to HDMI ${port}`); return true; },

    // Phone setup and guest Wi-Fi
    startSetup: () => JSON.stringify({ url: 'http://192.168.1.50:8080', pin: '482193' }),
    stopSetup: () => {},
    guestWifi: () => JSON.stringify({ ssid: 'Home Guest', payload: 'WIFI:T:WPA;S:Home Guest;P:demo-password;;' }),
    wallpapers: () => '[]',

    // Home screen, clean-up and the safety net
    isDefaultHome: () => tv.home,
    requestDefaultHome: () => { setTimeout(() => { tv.home = true; window.launcherResume && window.launcherResume(); note('this launcher is now the home screen'); }, 900); return 'started'; },
    hasPrevHome: () => tv.prevHome,
    safetyReady: () => tv.safety,
    adbConnect: () => {
      emit('adb', { state: 'connecting', message: 'Connecting to the TV' });
      emit('adb', { state: 'approve', message: 'On the TV, choose Always allow, then OK' }, 700);
      emit('adb', { state: 'ready', message: 'Connected', model: 'LOGIK 4K Android TV (demo)', android: '11', off: tv.off.length }, 2200);
      tv.adb = true;
    },
    adbSafetyTest: () => { tv.safety = true; emit('adb', { state: 'done', message: 'The safety net works on this TV' }, 800); },
    adbSetHome: () => { tv.home = true; tv.prevHome = true; adbDone('This launcher is now the home screen'); },
    adbRestoreHome: () => { tv.home = false; adbDone('The TV\'s own home screen is back'); },
    deepCleanList: () => JSON.stringify(DEEP),
    adbDeepClean: (tier, only) => {
      const list = DEEP.filter((d) => d.tier === tier && (!only || d.pkg === only));
      if (tier === 'google' && !(tv.home && tv.safety)) return emit('adb', { state: 'error', message: 'Make this the home screen and test the safety net first' }, 300);
      emit('adb', { state: 'working', message: 'Switching off' });
      adbDone(`Switched off ${switchOff(list)} of ${list.length}`);
    },
    adbDisable: () => { emit('adb', { state: 'working', message: 'Switching off' }); adbDone('Switched off the apps you chose'); },
    adbRestore: () => { DEEP.forEach((d) => { d.enabled = true; }); const n = tv.off.length; tv.off = []; adbDone(`Switched back on ${n} of ${n}`); },
    adbReapply: () => adbDone('Nothing to switch off again'),
    firmwareCheck: () => JSON.stringify({ changed: false, reenabled: [] }),
    chosenApps: () => '[]',
    packageStates: () => '[]',

    // Updates and Diagnostics
    installUpdate: () => {
      emit('update', { state: 'downloading' });
      emit('update', { state: 'error', message: 'Demo: updates install on the TV' }, 1500);
    },
    diagnostics: () => JSON.stringify({
      app: '0.18 (demo)', firmware: 'Logik 4K (demo)', android: '11 (API 30)', webview: '120.0', memory: '612 MB of 1460 MB', storage: '3120 MB of 8000 MB',
      uptime: '3 days', adb: tv.adb ? 'Connected' : tv.safety ? 'Trusted (safety net tested)' : 'Not connected', listener: true, switchedOff: tv.off.length,
      exits: ['2 Nov 21:14  closed by the TV for memory, using 182 MB'], events: tv.safety ? ['Today  safety net tested'] : [],
    }),
  };
})();
