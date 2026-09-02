/* Shared pure helpers. Kept dependency-free so Node's built-in test runner can load it. */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VideoSummaryShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function formatTimestamp(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h ? '[' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ']'
      : '[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ']';
  }

  function normalizeSegments(segments) {
    return (Array.isArray(segments) ? segments : []).map(function(item) {
      return {
        start: Number(item.start) || 0,
        end: Number(item.end) || ((Number(item.start) || 0) + (Number(item.duration) || 0)),
        text: String(item.text || '').replace(/\s+/g, ' ').trim()
      };
    }).filter(function(item) { return item.text; }).sort(function(a, b) { return a.start - b.start; });
  }

  function transcriptText(segments) {
    return normalizeSegments(segments).map(function(item) {
      return formatTimestamp(item.start) + ' ' + item.text;
    }).join('\n');
  }

  function buildTranscript(raw) {
    var segments = normalizeSegments(raw.segments);
    return {
      platform: raw.platform,
      videoId: String(raw.videoId || ''),
      title: String(raw.title || '未命名视频'),
      channel: String(raw.channel || ''),
      url: String(raw.url || ''),
      language: String(raw.language || 'unknown'),
      segments: segments,
      text: transcriptText(segments)
    };
  }

  function preferredTrack(tracks) {
    var usable = (Array.isArray(tracks) ? tracks : []).filter(function(track) { return track && track.baseUrl; });
    if (!usable.length) return null;
    return usable.find(function(track) { return /^zh(-|$)/i.test(track.languageCode || ''); }) || usable[0];
  }

  var SUMMARY_PRESETS = [
    { id: 'overview', name: '概览与时间线', instruction: '按“摘要、时间线、关键观点、结论”四个部分总结。时间线按内容发展顺序列出。' },
    { id: 'segmented', name: '分段总结', instruction: '先输出“摘要”，再输出“分段总结”。按字幕主题自然分段，每段使用“### [开始时间]–[结束时间] 段落主题”作为标题，并说明该段的核心内容、论据或步骤；最后输出“关键观点”和“结论”。' },
    { id: 'brief', name: '极简速览', instruction: '输出“摘要”和“关键结论”两部分。关键结论限制为 5–10 条，每条都必须附带最相关的时间戳。' }
  ];

  function parseTimestamp(value) {
    var match = /^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]$/.exec(String(value || ''));
    if (!match) return null;
    var hours = Number(match[1] || 0), minutes = Number(match[2]), seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function findTimestamps(text) {
    var pattern = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;
    var result = [], match;
    while ((match = pattern.exec(String(text || '')))) {
      var token = match[0], seconds = parseTimestamp(token);
      if (seconds !== null) result.push({ token: token, seconds: seconds, index: match.index, end: pattern.lastIndex });
    }
    return result;
  }

  function platformForUrl(url) {
    if (/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/i.test(url || '')) return 'bilibili';
    if (/^https:\/\/(?:www\.)?youtube\.com\/(watch|shorts)/.test(url || '') || /^https:\/\/youtu\.be\//.test(url || '')) return 'youtube';
    return null;
  }

  function normalizeVideoUrl(value) {
    var url;
    try { url = new URL(String(value || '').trim()); } catch (_) { return null; }
    var host = url.hostname.toLowerCase();
    if (host === 'www.bilibili.com' && /^\/video\/BV[0-9A-Za-z]+\/?$/i.test(url.pathname)) {
      var bvid = url.pathname.split('/').filter(Boolean)[1];
      var page = Number(url.searchParams.get('p') || 1);
      if (!Number.isInteger(page) || page < 1) return null;
      return { platform: 'bilibili', id: bvid, url: 'https://www.bilibili.com/video/' + bvid + '/' + (page === 1 ? '' : '?p=' + page) };
    }
    var videoId = '';
    if ((host === 'www.youtube.com' || host === 'youtube.com') && url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
    else if ((host === 'www.youtube.com' || host === 'youtube.com') && /^\/shorts\//.test(url.pathname)) videoId = url.pathname.split('/')[2] || '';
    else if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    if (/^[0-9A-Za-z_-]{6,}$/.test(videoId)) return { platform: 'youtube', id: videoId, url: 'https://www.youtube.com/watch?v=' + videoId };
    return null;
  }

  function normalizeFontSize(value) {
    var size = Math.round(Number(value));
    if (!Number.isFinite(size)) return 18;
    return Math.max(16, Math.min(28, size));
  }

  function safeFilename(value) {
    var text = String(value || 'video').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim();
    return (text || 'video').slice(0, 100);
  }

  function markdownForTranscript(video) {
    return [
      '# ' + video.title,
      '',
      '- **平台**：' + video.platform,
      '- **频道/UP主**：' + (video.channel || '未知'),
      '- **链接**：' + video.url,
      '- **字幕语言**：' + video.language,
      '- **提取时间**：' + new Date().toLocaleString('zh-CN'),
      '', '---', '', '## 带时间戳字幕', '', video.text
    ].join('\n');
  }

  function markdownForSummary(video, summary, promptName) {
    return markdownForTranscript(video) + [
      '', '', '---', '', '## DeepSeek 总结', '',
      '- **提示词**：' + (promptName || '内置默认提示词'), '', summary || ''
    ].join('\n');
  }

  return {
    formatTimestamp: formatTimestamp,
    normalizeSegments: normalizeSegments,
    transcriptText: transcriptText,
    buildTranscript: buildTranscript,
    preferredTrack: preferredTrack,
    SUMMARY_PRESETS: SUMMARY_PRESETS,
    parseTimestamp: parseTimestamp,
    findTimestamps: findTimestamps,
    platformForUrl: platformForUrl,
    normalizeVideoUrl: normalizeVideoUrl,
    normalizeFontSize: normalizeFontSize,
    safeFilename: safeFilename,
    markdownForTranscript: markdownForTranscript,
    markdownForSummary: markdownForSummary
  };
});
