const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-capture.js'), 'utf8');

function loadCapture(body, resourceUrl) {
  const posted = [];
  class FakeXhr {
    addEventListener() {}
  }
  FakeXhr.prototype.open = function() {};
  FakeXhr.prototype.send = function() {};
  const window = {
    fetch() { return Promise.resolve({ clone() { return { text: async () => body }; } }); },
    addEventListener() {},
    postMessage(message) { posted.push(message); }
  };
  const context = {
    URL,
    Promise,
    window,
    XMLHttpRequest: FakeXhr,
    performance: { getEntriesByType() { return resourceUrl ? [{ name: resourceUrl }] : []; } },
    location: { href: 'https://www.youtube.com/watch?v=9Ln-WuSBluw' },
    document: {
      createElement() { return { innerHTML: '', get value() { return this.innerHTML.replace(/&amp;/g, '&'); } }; }
    }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: 'youtube-capture.js' }).runInContext(context);
  return { window, posted };
}

test('captures the player\'s JSON3 timedtext response without re-fetching it', async () => {
  const { window, posted } = loadCapture(JSON.stringify({ events: [{ tStartMs: 1200, dDurationMs: 2500, segs: [{ utf8: 'Live caption' }] }] }));
  await window.fetch('https://www.youtube.com/api/timedtext?v=9Ln-WuSBluw&lang=en&pot=player-token');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), {
    source: 'vidgist-youtube-caption-capture', videoId: '9Ln-WuSBluw', language: 'en',
    segments: [{ start: 1.2, duration: 2.5, text: 'Live caption' }]
  });
});

test('captures XML timedtext responses used by legacy player paths', async () => {
  const { window, posted } = loadCapture('<transcript><text start="2" dur="3">Hello &amp; welcome</text></transcript>');
  await window.fetch('https://www.youtube.com/api/timedtext?v=9Ln-WuSBluw&lang=en');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(posted[0].segments)), [{ start: 2, duration: 3, text: 'Hello & welcome' }]);
});

test('replays the player\'s Resource Timing URL when its transport bypasses fetch and XHR', async () => {
  const { posted } = loadCapture(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Captured via player token' }] }] }), 'https://www.youtube.com/api/timedtext?v=9Ln-WuSBluw&lang=en&pot=player-token');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(posted[0].segments[0].text, 'Captured via player token');
});
