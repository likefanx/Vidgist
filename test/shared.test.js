const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../shared.js');

test('normalizes timestamped transcript segments', () => {
  const video = shared.buildTranscript({ platform: 'YouTube', videoId: 'abc', title: 'Demo', segments: [
    { start: 61.4, duration: 2, text: ' 第二句\n内容 ' }, { start: 2, end: 3, text: '第一句' }
  ] });
  assert.equal(video.text, '[00:02] 第一句\n[01:01] 第二句 内容');
  assert.equal(video.segments[1].end, 63.4);
});

test('prefers Chinese caption tracks and falls back to first', () => {
  const tracks = [{ languageCode: 'en', baseUrl: 'english' }, { languageCode: 'zh-Hans', baseUrl: 'chinese' }];
  assert.equal(shared.preferredTrack(tracks).baseUrl, 'chinese');
  assert.equal(shared.preferredTrack([{ languageCode: 'ja', baseUrl: 'jp' }]).baseUrl, 'jp');
});

test('creates safe markdown exports without secrets', () => {
  const video = shared.buildTranscript({ platform: 'Bilibili', videoId: 'BV1', title: 'a/b', url: 'https://example.test', language: '中文', segments: [{ start: 0, text: '字幕' }] });
  const markdown = shared.markdownForSummary(video, '## 摘要\n内容', '学习');
  assert.match(markdown, /## 带时间戳字幕/);
  assert.match(markdown, /## DeepSeek 总结/);
  assert.equal(shared.safeFilename('a/b:*?'), 'a_b___');
  assert.doesNotMatch(markdown, /api[_ -]?key/i);
});

test('parses clickable minute and hour timestamps without accepting invalid values', () => {
  assert.equal(shared.parseTimestamp('[01:23]'), 83);
  assert.equal(shared.parseTimestamp('[01:02:03]'), 3723);
  assert.equal(shared.parseTimestamp('[01:61]'), null);
  assert.deepEqual(shared.findTimestamps('先看 [00:08]，再看 [01:02:03]。').map((item) => item.seconds), [8, 3723]);
});

test('exposes the three summary presets and only supports video URLs', () => {
  assert.deepEqual(shared.SUMMARY_PRESETS.map((preset) => preset.id), ['overview', 'segmented', 'brief']);
  assert.equal(shared.platformForUrl('https://www.bilibili.com/video/BV1x/'), 'bilibili');
  assert.equal(shared.platformForUrl('https://www.youtube.com/watch?v=abc'), 'youtube');
  assert.equal(shared.platformForUrl('https://example.com/watch?v=abc'), null);
});

test('normalizes supported external batch inputs without accepting ambiguous Bilibili URLs', () => {
  assert.deepEqual(shared.normalizeVideoUrl('https://www.bilibili.com/video/BV1abcD12345/?p=2'), {
    platform: 'bilibili', id: 'BV1abcD12345', url: 'https://www.bilibili.com/video/BV1abcD12345/?p=2'
  });
  assert.deepEqual(shared.normalizeVideoUrl('https://youtu.be/abcdefghijk?t=4'), {
    platform: 'youtube', id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk'
  });
  assert.equal(shared.normalizeVideoUrl('https://www.bilibili.com/video/av123'), null);
});

test('keeps summary font sizes within the supported slider range', () => {
  assert.equal(shared.normalizeFontSize(21.4), 21);
  assert.equal(shared.normalizeFontSize(5), 16);
  assert.equal(shared.normalizeFontSize(99), 28);
  assert.equal(shared.normalizeFontSize('invalid'), 18);
});
