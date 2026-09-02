const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const requestedId = 'OcKl98ZQbMQ';

function playerResponse(videoId, options = {}) {
  const response = { videoDetails: { videoId, title: options.title || videoId, author: 'Channel' } };
  if (options.captions !== false) {
    response.captions = { playerCaptionsTracklistRenderer: { captionTracks: options.tracks || [{
      baseUrl: 'https://www.youtube.com/api/timedtext?v=' + encodeURIComponent(videoId),
      languageCode: 'en',
      name: { simpleText: 'English' }
    }] } };
  }
  return response;
}

function loadExtractor(page = {}) {
  const port = { postMessage() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } };
  const context = {
    URL,
    VideoSummaryShared: {},
    importScripts() {},
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    clearTimeout() {},
    chrome: {
      sidePanel: { setPanelBehavior() { return Promise.resolve(); } },
      tabs: {
        query() {}, create() {}, remove() { return Promise.resolve(); }, get() {},
        onActivated: { addListener() {} },
        onUpdated: { addListener() {}, removeListener() {} }
      },
      scripting: { executeScript() { return Promise.resolve([]); } },
      downloads: { download() {} },
      storage: { local: {}, sync: {} },
      runtime: {
        connectNative() { return port; },
        getManifest() { return { version: 'test' }; },
        sendMessage(_message, callback) { if (callback) callback(); },
        onMessage: { addListener() {} }
      }
    },
    window: page.window || {},
    document: {
      title: 'Current video - YouTube',
      scripts: page.scripts || [],
      documentElement: { lang: 'zh-CN' },
      createElement() { return { innerHTML: '', get value() { return this.innerHTML.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); } }; },
      querySelector(selector) {
        if (selector === '#movie_player') return page.moviePlayer || null;
        if (selector === 'ytd-player') return page.ytdPlayer || null;
        return null;
      }
    },
    location: { href: 'https://www.youtube.com/watch?v=' + requestedId },
    fetch: page.fetch || (async function() {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: 'caption text' }] }] });
        }
      };
    })
  };
  vm.createContext(context);
  new vm.Script(backgroundSource, { filename: 'background.js' }).runInContext(context);
  return context.extractYouTubeInMainWorld;
}

test('uses a matching live movie player response instead of stale SPA initial state', async () => {
  const fresh = playerResponse(requestedId, { title: 'Requested video' });
  const extract = loadExtractor({
    window: { ytInitialPlayerResponse: playerResponse('StaleVideo1') },
    moviePlayer: { getPlayerResponse() { return fresh; } }
  });

  const result = await extract({ id: requestedId, url: 'https://www.youtube.com/watch?v=' + requestedId });

  assert.equal(result.videoId, requestedId);
  assert.equal(result.title, 'Requested video');
  assert.equal(result.segments[0].text, 'caption text');
});

test('collects matching responses from ytd-player, ytplayer, ytcfg, and parsed scripts', async (t) => {
  const fresh = playerResponse(requestedId);
  const cases = {
    'ytd-player': { ytdPlayer: { playerResponse: fresh } },
    ytplayer: { window: { ytplayer: { config: { args: { player_response: JSON.stringify(fresh) } } } } },
    ytcfg: { window: { ytcfg: { get(name) { return name === 'PLAYER_VARS' ? { player_response: JSON.stringify(fresh) } : null; } } } },
    scripts: { scripts: [{ textContent: 'window.ytInitialPlayerResponse = ' + JSON.stringify(fresh) + ';' }] }
  };

  for (const [name, page] of Object.entries(cases)) {
    await t.test(name, async () => {
      page.window = Object.assign({ ytInitialPlayerResponse: playerResponse('StaleVideo1') }, page.window);
      const result = await loadExtractor(page)({ id: requestedId });
      assert.equal(result.videoId, requestedId);
    });
  }
});

test('retries candidate collection while the SPA player catches up', async () => {
  let reads = 0;
  const extract = loadExtractor({
    window: { ytInitialPlayerResponse: playerResponse('StaleVideo1') },
    moviePlayer: { getPlayerResponse() { return ++reads < 3 ? playerResponse('StaleVideo1') : playerResponse(requestedId); } }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.videoId, requestedId);
  assert.equal(reads, 3);
});

test('retries when matching video details arrive before their captions', async () => {
  let reads = 0;
  const extract = loadExtractor({
    moviePlayer: { getPlayerResponse() { return ++reads < 3 ? playerResponse(requestedId, { captions: false }) : playerResponse(requestedId); } }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.videoId, requestedId);
  assert.equal(result.segments[0].text, 'caption text');
  assert.equal(reads, 3);
});

test('requires an exact case-sensitive requested video ID match', async () => {
  let fetched = false;
  const extract = loadExtractor({
    window: { ytInitialPlayerResponse: playerResponse('ocKl98ZQbMQ') },
    fetch: async function() { fetched = true; throw new Error('must not fetch'); }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.error, 'YouTube 页面播放器 ID 与请求视频不一致，请重试');
  assert.equal(fetched, false);
});

test('prefers a matching response that already has usable captions', async () => {
  const extract = loadExtractor({
    moviePlayer: { getPlayerResponse() { return playerResponse(requestedId, { captions: false }); } },
    ytdPlayer: { playerResponse: playerResponse(requestedId, { title: 'Hydrated response' }) }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.videoId, requestedId);
  assert.equal(result.title, 'Hydrated response');
});

test('tries another matching caption track when the preferred track is empty', async () => {
  const tracks = [
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=empty', languageCode: 'zh-Hant', name: { simpleText: '繁中' } },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=working', languageCode: 'zh-Hans', name: { simpleText: '简中' } }
  ];
  const extract = loadExtractor({
    moviePlayer: { getPlayerResponse() { return playerResponse(requestedId, { tracks }); } },
    fetch: async function(url) {
      const video = new URL(url).searchParams.get('v');
      return {
        ok: true,
        status: 200,
        async text() {
          return video === 'working' ? JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '备用字幕' }] }] }) : '';
        }
      };
    }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.language, '简中');
  assert.equal(result.segments[0].text, '备用字幕');
});

test('parses XML/SRV subtitle responses when JSON and VTT are unavailable', async () => {
  const extract = loadExtractor({
    moviePlayer: { getPlayerResponse() { return playerResponse(requestedId); } },
    fetch: async function(url) {
      const format = new URL(url).searchParams.get('fmt');
      return {
        ok: true,
        status: 200,
        async text() {
          return format === 'srv3' ? '<timedtext><body><p t="1500" d="2500">Hello &amp; welcome</p></body></timedtext>' : '';
        }
      };
    }
  });

  const result = await extract({ id: requestedId });

  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [{ start: 1.5, duration: 2.5, text: 'Hello & welcome' }]);
});

test('falls back to the YouTube page transcript endpoint after empty caption tracks', async () => {
  const extract = loadExtractor({
    window: {
      ytcfg: {
        get(name) {
          return { INNERTUBE_CLIENT_VERSION: '2.test', VISITOR_DATA: 'visitor' }[name] || '';
        }
      }
    },
    moviePlayer: { getPlayerResponse() { return playerResponse(requestedId); } },
    fetch: async function(url) {
      if (url.includes('/api/timedtext')) return { ok: true, status: 200, async text() { return ''; } };
      if (url.includes('/youtubei/v1/next')) {
        return { ok: true, status: 200, async json() { return { engagementPanels: [{ getTranscriptEndpoint: { params: 'fresh-params' } }] }; } };
      }
      if (url.includes('/youtubei/v1/get_transcript')) {
        return { ok: true, status: 200, async json() { return { actions: [{ transcriptSegmentListRenderer: { initialSegments: [{ transcriptSegmentRenderer: { startMs: '1000', endMs: '3500', snippet: { runs: [{ text: '页面文字稿' }] } } }] } }] }; } };
      }
      throw new Error('unexpected URL');
    }
  });

  const result = await extract({ id: requestedId });

  assert.equal(result.language, 'YouTube 页面文字稿');
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [{ start: 1, duration: 2.5, text: '页面文字稿' }]);
  assert.equal(result.source.transcriptFallback, true);
});
