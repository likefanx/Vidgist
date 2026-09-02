/* global importScripts, chrome */
importScripts('shared.js');
var Shared = VideoSummaryShared;
var SETTINGS_KEY = 'deepseekSettings';
var PROMPTS_KEY = 'customPrompts';
var PREFERENCES_KEY = 'uiPreferences';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function() {});

function storageGet(area, keys) {
  return new Promise(function(resolve) { area.get(keys, resolve); });
}
function storageSet(area, value) {
  return new Promise(function(resolve) { area.set(value, resolve); });
}
function activeTab() {
  return new Promise(function(resolve) { chrome.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) { resolve(tabs[0] || null); }); });
}
function platformForUrl(url) {
  return Shared.platformForUrl(url);
}
function execute(tabId, func, args) {
  return chrome.scripting.executeScript({ target: { tabId: tabId }, world: 'MAIN', func: func, args: args || [] }).then(function(results) {
    return results[0] && results[0].result;
  });
}
function sendTabMessage(tabId, message) {
  return new Promise(function(resolve) {
    chrome.tabs.sendMessage(tabId, message, function(response) { resolve(chrome.runtime.lastError ? null : response || null); });
  });
}
async function waitForCapturedYouTubeTranscript(tabId, videoId) {
  for (var attempt = 0; attempt < 12; attempt++) {
    var captured = await sendTabMessage(tabId, { type: 'getCapturedYouTubeTranscript' });
    if (captured && captured.videoId === videoId && Array.isArray(captured.segments) && captured.segments.length) return captured;
    if (attempt < 11) await new Promise(function(resolve) { setTimeout(resolve, 250); });
  }
  return null;
}

async function getCurrentTranscript() {
  var tab = await activeTab();
  if (!tab) return { error: '没有活动标签页' };
  try {
    return { video: await getTranscriptForTab(tab) };
  } catch (error) {
    return { error: error.message || '字幕提取失败' };
  }
}

async function getTranscriptForTab(tab) {
  var input = Shared.normalizeVideoUrl(tab && tab.url);
  if (!input) throw new Error('请打开有效的 B站视频或 YouTube 视频页面');
  if (input.platform === 'youtube') {
    var captured = await waitForCapturedYouTubeTranscript(tab.id, input.id);
    if (captured && captured.videoId === input.id && Array.isArray(captured.segments) && captured.segments.length) {
      var capturedRaw = {
        platform: 'YouTube', videoId: input.id, title: String(tab.title || '').replace(/\s*-\s*YouTube\s*$/i, '') || input.id,
        channel: '', url: input.url, language: captured.language || 'unknown', segments: captured.segments,
        source: { requestedUrl: input.url, capturedFromPlayer: true }
      };
      return Shared.buildTranscript(capturedRaw);
    }
  }
  var raw = await execute(tab.id, input.platform === 'bilibili' ? extractBilibiliInMainWorld : extractYouTubeInMainWorld, [input]);
  if (!raw || raw.error) throw new Error((raw && raw.error) || '字幕提取失败');
  var video = Shared.buildTranscript(raw);
  var idsMatch = input.platform === 'youtube'
    ? String(video.videoId) === String(input.id)
    : String(video.videoId).toLowerCase() === String(input.id).toLowerCase();
  if (!idsMatch) throw new Error('提取结果的视频 ID 与请求 URL 不一致，已拒绝返回字幕');
  video.source = raw.source || { requestedUrl: input.url };
  return video;
}

async function getSettings() {
  var data = await storageGet(chrome.storage.local, SETTINGS_KEY);
  var settings = data[SETTINGS_KEY] || {};
  return { hasApiKey: Boolean(settings.apiKey), model: settings.model || 'deepseek-v4-flash' };
}
async function saveSettings(request) {
  var data = await storageGet(chrome.storage.local, SETTINGS_KEY);
  var current = data[SETTINGS_KEY] || {};
  var next = { apiKey: current.apiKey || '', model: request.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash' };
  if (request.clearApiKey) next.apiKey = '';
  else if (String(request.apiKey || '').trim()) next.apiKey = String(request.apiKey).trim();
  await storageSet(chrome.storage.local, { [SETTINGS_KEY]: next });
  return { hasApiKey: Boolean(next.apiKey), model: next.model };
}
async function getPrompts() {
  var data = await storageGet(chrome.storage.sync, PROMPTS_KEY);
  return data[PROMPTS_KEY] || [];
}
async function getPromptCatalog() {
  return { presets: Shared.SUMMARY_PRESETS.map(function(preset) { return { id: preset.id, name: preset.name }; }), prompts: await getPrompts() };
}
async function getPreferences() {
  var data = await storageGet(chrome.storage.local, PREFERENCES_KEY);
  var preferences = data[PREFERENCES_KEY] || {};
  return { summaryFontSize: Shared.normalizeFontSize(preferences.summaryFontSize), selectedPromptValue: typeof preferences.selectedPromptValue === 'string' ? preferences.selectedPromptValue : 'preset:overview' };
}
async function savePreferences(request) {
  var current = await getPreferences();
  var next = {
    summaryFontSize: request.summaryFontSize === undefined ? current.summaryFontSize : Shared.normalizeFontSize(request.summaryFontSize),
    selectedPromptValue: typeof request.selectedPromptValue === 'string' ? request.selectedPromptValue : current.selectedPromptValue
  };
  await storageSet(chrome.storage.local, { [PREFERENCES_KEY]: next });
  return next;
}
async function savePrompt(prompt) {
  var prompts = await getPrompts();
  var entry = { id: prompt.id || crypto.randomUUID(), name: String(prompt.name || '').trim(), content: String(prompt.content || '').trim() };
  if (!entry.name || !entry.content) throw new Error('请填写提示词名称和内容');
  var index = prompts.findIndex(function(item) { return item.id === entry.id; });
  if (index >= 0) prompts[index] = entry; else prompts.push(entry);
  await storageSet(chrome.storage.sync, { [PROMPTS_KEY]: prompts });
  return prompts;
}
async function deletePrompt(id) {
  var prompts = (await getPrompts()).filter(function(item) { return item.id !== id; });
  await storageSet(chrome.storage.sync, { [PROMPTS_KEY]: prompts });
  return prompts;
}

var BASE_INSTRUCTION = [
  '请仅依据给定的视频字幕，以简体中文输出 Markdown 总结。',
  '所有涉及视频内容的要点和段落标题都尽可能保留可追溯的 [MM:SS] 或 [HH:MM:SS] 时间戳。',
  '信息不足时明确说明，不要编造。'
].join('\n');
async function summarize(video, presetId, customPrompt) {
  var data = await storageGet(chrome.storage.local, SETTINGS_KEY);
  var settings = data[SETTINGS_KEY] || {};
  if (!settings.apiKey) throw new Error('请先在设置中保存 DeepSeek API Key');
  if (!video || !video.text) throw new Error('没有可总结的字幕');
  var preset = Shared.SUMMARY_PRESETS.find(function(item) { return item.id === presetId; }) || Shared.SUMMARY_PRESETS[0];
  var userContent = (customPrompt ? '用户额外要求（与所选格式共同生效）：\n' + customPrompt + '\n\n' : '') +
    '视频标题：' + video.title + '\n视频链接：' + video.url + '\n字幕：\n' + video.text;
  var response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
    body: JSON.stringify({ model: settings.model || 'deepseek-v4-flash', thinking: { type: 'disabled' }, messages: [
      { role: 'system', content: BASE_INSTRUCTION + '\n\n所选总结格式：\n' + preset.instruction }, { role: 'user', content: userContent }
    ] })
  });
  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error && body.error.message ? body.error.message : 'DeepSeek 请求失败（HTTP ' + response.status + '）');
  var content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!content || !String(content).trim()) throw new Error('DeepSeek 返回了空结果');
  return String(content).trim();
}
async function seekToTimestamp(seconds) {
  seconds = Number(seconds);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('时间戳无效');
  var tab = await activeTab();
  if (!tab || !platformForUrl(tab.url)) throw new Error('请切换到 B站或 YouTube 视频页面后重试');
  var result = await execute(tab.id, seekVideoInMainWorld, [seconds]);
  if (!result || result.error) throw new Error((result && result.error) || '视频跳转失败');
  return result;
}
function download(filename, text) {
  return new Promise(function(resolve, reject) {
    var url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text);
    chrome.downloads.download({ url: url, filename: filename, saveAs: true, conflictAction: 'uniquify' }, function(id) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(id);
    });
  });
}
function notifyPanels() { chrome.runtime.sendMessage({ type: 'videoContextChanged' }, function() { void chrome.runtime.lastError; }); }
chrome.tabs.onActivated.addListener(notifyPanels);
chrome.tabs.onUpdated.addListener(function(_id, info) { if (info.status === 'complete' || info.url) notifyPanels(); });

// Local automation bridge.  The native host only receives URLs and transcript
// results; authentication always remains inside the browser profile.
var NATIVE_HOST_NAME = 'com.aicode.vidgist_subtitles';
var nativePort = null;
var nativeQueue = [];
var nativeRunning = false;

function nativeSend(message) {
  try { if (nativePort) nativePort.postMessage(message); } catch (_) { nativePort = null; }
}
function connectNativeBridge() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort.onMessage.addListener(function(message) {
      if (message && message.type === 'job') acceptNativeJob(message);
    });
    nativePort.onDisconnect.addListener(function() {
      nativePort = null;
      setTimeout(connectNativeBridge, 3000);
    });
    nativeSend({ type: 'extensionReady', version: chrome.runtime.getManifest().version });
  } catch (_) { nativePort = null; }
}
function acceptNativeJob(message) {
  var inputs = (Array.isArray(message.videos) ? message.videos : []).map(Shared.normalizeVideoUrl).filter(Boolean);
  var seen = {};
  inputs = inputs.filter(function(input) { if (seen[input.url]) return false; seen[input.url] = true; return true; });
  if (!inputs.length) return nativeSend({ type: 'jobResult', jobId: message.jobId, success: false, error: '没有有效的 B站或 YouTube 视频 URL' });
  nativeQueue.push({ id: message.jobId, inputs: inputs, items: [], current: 0 });
  nativeSend({ type: 'jobAccepted', jobId: message.jobId, total: inputs.length });
  runNativeQueue();
}
function waitForTab(tabId, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(finish.bind(null, new Error('视频页面加载超时')), timeoutMs);
    function finish(error, tab) {
      if (done) return; done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error); else resolve(tab);
    }
    function onUpdated(id, info, tab) { if (id === tabId && info.status === 'complete') finish(null, tab); }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, function(tab) { if (chrome.runtime.lastError) finish(new Error(chrome.runtime.lastError.message)); else if (tab.status === 'complete') finish(null, tab); });
  });
}
function sendNativeItem(jobId, item) {
  // Chrome limits extension -> native-host messages to 1 MiB.  Chunk the JSON
  // payload so long caption tracks remain available to callers.
  var encoded = JSON.stringify(item);
  if (encoded.length <= 180000) return nativeSend({ type: 'itemResult', jobId: jobId, item: item });
  var size = 180000, total = Math.ceil(encoded.length / size);
  for (var index = 0; index < total; index++) nativeSend({ type: 'itemChunk', jobId: jobId, index: index, total: total, data: encoded.slice(index * size, (index + 1) * size) });
}
async function runNativeQueue() {
  if (nativeRunning || !nativeQueue.length) return;
  nativeRunning = true;
  var job = nativeQueue[0];
  try {
    while (job.current < job.inputs.length) {
      var input = job.inputs[job.current];
      nativeSend({ type: 'jobProgress', jobId: job.id, status: 'running', current: job.current + 1, total: job.inputs.length, url: input.url });
      var item = { url: input.url, platform: input.platform, id: input.id, status: 'error' };
      var tab = null;
      try {
        tab = await chrome.tabs.create({ url: input.url, active: false });
        tab = await waitForTab(tab.id, 30000);
        // Sites hydrate player state after the navigation is technically complete.
        await new Promise(function(resolve) { setTimeout(resolve, 1200); });
        item.video = await getTranscriptForTab(tab);
        item.markdown = Shared.markdownForTranscript(item.video);
        item.status = 'ok';
      } catch (error) { item.error = error.message || '字幕提取失败'; }
      finally { if (tab && tab.id) chrome.tabs.remove(tab.id).catch(function() {}); }
      job.items.push(item); sendNativeItem(job.id, item); job.current++;
    }
    nativeSend({ type: 'jobResult', jobId: job.id, success: true, summary: summarizeNativeItems(job.items) });
  } catch (error) { nativeSend({ type: 'jobResult', jobId: job.id, success: false, error: error.message || '批量任务失败', summary: summarizeNativeItems(job.items) }); }
  finally { nativeQueue.shift(); nativeRunning = false; runNativeQueue(); }
}
function summarizeNativeItems(items) {
  return items.reduce(function(summary, item) { summary[item.status === 'ok' ? 'ok' : 'error']++; return summary; }, { ok: 0, error: 0 });
}
connectNativeBridge();

chrome.runtime.onMessage.addListener(function(request, _sender, sendResponse) {
  (async function() {
    switch (request.type) {
      case 'pageChanged': notifyPanels(); return { ok: true };
      case 'getTranscript': return getCurrentTranscript();
      case 'getSettings': return getSettings();
      case 'saveSettings': return saveSettings(request);
      case 'getPrompts': return getPromptCatalog();
      case 'getPreferences': return getPreferences();
      case 'savePreferences': return savePreferences(request);
      case 'savePrompt': return { prompts: await savePrompt(request.prompt || {}) };
      case 'deletePrompt': return { prompts: await deletePrompt(request.id) };
      case 'summarize': return { summary: await summarize(request.video, request.presetId, request.customPrompt) };
      case 'seekToTimestamp': return { seek: await seekToTimestamp(request.seconds) };
      case 'download': await download(request.filename, request.text); return { ok: true };
      default: throw new Error('未知请求');
    }
  })().then(sendResponse).catch(function(error) { sendResponse({ error: error.message || '操作失败' }); });
  return true;
});

function seekVideoInMainWorld(seconds) {
  var video = document.querySelector('video');
  if (!video) return { error: '页面播放器尚未就绪' };
  var duration = Number(video.duration);
  var target = Number(seconds);
  if (Number.isFinite(duration)) target = Math.min(target, Math.max(0, duration - 0.1));
  video.currentTime = target;
  var playResult = video.play();
  if (playResult && typeof playResult.catch === 'function') playResult.catch(function() {});
  return { ok: true, seconds: target };
}

// Function bodies below run in the actual page world. They must be self-contained.
function extractYouTubeInMainWorld(expected) {
  function parseObjectAtMarker(source, markerIndex, marker) {
    var start = source.indexOf('{', markerIndex + marker.length);
    if (start < 0) return null;
    var depth = 0, quote = '', escaped = false;
    for (var index = start; index < source.length; index++) {
      var character = source.charAt(index);
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '{') depth++;
      if (character === '}') {
        depth--;
        if (depth === 0) { try { return JSON.parse(source.slice(start, index + 1)); } catch (_) { return null; } }
      }
    }
    return null;
  }
  function parseObjectsAfterMarker(source, marker) {
    var parsed = [], from = 0, markerIndex;
    while ((markerIndex = source.indexOf(marker, from)) >= 0) {
      var value = parseObjectAtMarker(source, markerIndex, marker);
      if (value) parsed.push(value);
      from = markerIndex + marker.length;
    }
    return parsed;
  }
  function parsePlayerResponse(value) {
    if (!value) return null;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return null; } }
    return typeof value === 'object' ? value : null;
  }
  function addCandidate(candidates, value) {
    var parsed = parsePlayerResponse(value);
    if (parsed) candidates.push(parsed);
  }
  function addConfigCandidates(candidates, config) {
    if (!config) return;
    addCandidate(candidates, config.player_response);
    addCandidate(candidates, config.playerResponse);
    addCandidate(candidates, config.args && config.args.player_response);
  }
  function getPlayerResponseCandidates() {
    var candidates = [];
    var moviePlayer = document.querySelector('#movie_player');
    if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
      try { addCandidate(candidates, moviePlayer.getPlayerResponse()); } catch (_) {}
    }
    var playerElement = document.querySelector('ytd-player');
    if (playerElement) {
      if (typeof playerElement.getPlayerResponse === 'function') {
        try { addCandidate(candidates, playerElement.getPlayerResponse()); } catch (_) {}
      }
      addCandidate(candidates, playerElement.playerResponse);
      if (playerElement.player_ && typeof playerElement.player_.getPlayerResponse === 'function') {
        try { addCandidate(candidates, playerElement.player_.getPlayerResponse()); } catch (_) {}
      }
    }
    addCandidate(candidates, window.ytInitialPlayerResponse);
    addConfigCandidates(candidates, window.ytplayer && window.ytplayer.config);
    if (window.ytcfg && typeof window.ytcfg.get === 'function') {
      try { addConfigCandidates(candidates, window.ytcfg.get('PLAYER_VARS')); } catch (_) {}
      try { addConfigCandidates(candidates, window.ytcfg.get('PLAYER_CONFIG')); } catch (_) {}
    }
    addConfigCandidates(candidates, window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.PLAYER_VARS);
    addConfigCandidates(candidates, window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.PLAYER_CONFIG);
    var scripts = document.scripts || [];
    for (var index = 0; index < scripts.length; index++) {
      parseObjectsAfterMarker(scripts[index].textContent || '', 'ytInitialPlayerResponse').forEach(function(value) {
        addCandidate(candidates, value);
      });
    }
    return candidates;
  }
  function captionTracks(player) {
    return player && player.captions && player.captions.playerCaptionsTracklistRenderer && player.captions.playerCaptionsTracklistRenderer.captionTracks || [];
  }
  function selectMatchingPlayerResponse(candidates, requestedId) {
    if (!requestedId) return null;
    var matching = (candidates || []).filter(function(candidate) {
      return candidate && candidate.videoDetails && String(candidate.videoDetails.videoId || '') === String(requestedId);
    });
    return matching.find(function(candidate) { return captionTracks(candidate).some(function(track) { return track && track.baseUrl; }); }) || matching[0] || null;
  }
  function wait(milliseconds) {
    return new Promise(function(resolve) { setTimeout(resolve, milliseconds); });
  }
  function pick(tracks) {
    tracks = (tracks || []).filter(function(track) { return track && track.baseUrl; });
    return tracks.find(function(track) { return /^zh(-|$)/i.test(track.languageCode || ''); }) || tracks[0];
  }
  function orderedTracks(tracks) {
    tracks = (tracks || []).filter(function(track) { return track && track.baseUrl; });
    return tracks.filter(function(track) { return /^zh(-|$)/i.test(track.languageCode || ''); }).concat(
      tracks.filter(function(track) { return !/^zh(-|$)/i.test(track.languageCode || ''); })
    );
  }
  function secondsFromVtt(value) {
    var parts = String(value || '').trim().split(':').map(Number);
    if (parts.some(function(part) { return !Number.isFinite(part); })) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }
  function parseVtt(text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    var cuePattern = /(?:^|\n)(?:(?:\d+)\n)?((?:\d{2}:)?\d{2}:\d{2}(?:\.\d+)?)\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}(?:\.\d+)?)[^\n]*\n([\s\S]*?)(?=\n\n|$)/g;
    var segments = [], match;
    while ((match = cuePattern.exec(text))) {
      var start = secondsFromVtt(match[1]), end = secondsFromVtt(match[2]);
      var content = match[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (start !== null && end !== null && content) segments.push({ start: start, duration: Math.max(0, end - start), text: content });
    }
    return segments;
  }
  function decodeHtml(value) {
    var textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }
  function xmlAttribute(attributes, name) {
    var match = String(attributes || '').match(new RegExp('\\b' + name + '=["\\\']([^"\\\']*)["\\\']', 'i'));
    return match ? match[1] : '';
  }
  function parseTimedTextXml(text) {
    var segments = [], match;
    var cuePattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((match = cuePattern.exec(String(text || '')))) {
      var tag = match[1].toLowerCase();
      var attributes = match[2];
      var startValue = xmlAttribute(attributes, tag === 'p' ? 't' : 'start') || xmlAttribute(attributes, 'begin');
      var durationValue = xmlAttribute(attributes, tag === 'p' ? 'd' : 'dur');
      var start = Number(startValue), duration = Number(durationValue);
      if (tag === 'p' && Number.isFinite(start)) start /= 1000;
      if (tag === 'p' && Number.isFinite(duration)) duration /= 1000;
      var content = decodeHtml(match[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (Number.isFinite(start) && start >= 0 && content) segments.push({ start: start, duration: Number.isFinite(duration) && duration >= 0 ? duration : 0, text: content });
    }
    return segments;
  }
  async function fetchCaptionSegments(baseUrl) {
    var formats = ['json3', 'vtt', 'srv3', ''];
    for (var index = 0; index < formats.length; index++) {
      var url = new URL(baseUrl);
      if (formats[index]) url.searchParams.set('fmt', formats[index]); else url.searchParams.delete('fmt');
      var response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) continue;
      var body = await response.text();
      if (!body.trim()) continue;
      if (formats[index] === 'json3') {
        try {
          var payload = JSON.parse(body);
          var jsonSegments = (payload.events || []).map(function(event) {
            var text = (event.segs || []).map(function(seg) { return seg.utf8 || ''; }).join('').replace(/\n/g, ' ').trim();
            return { start: (event.tStartMs || 0) / 1000, duration: (event.dDurationMs || 0) / 1000, text: text };
          }).filter(function(segment) { return segment.text; });
          if (jsonSegments.length) return jsonSegments;
        } catch (_) {}
      } else {
        var segments = formats[index] === 'vtt' ? parseVtt(body) : parseTimedTextXml(body);
        if (segments.length) return segments;
      }
    }
    throw new Error('YouTube 字幕接口返回空内容');
  }
  function findNested(value, key) {
    if (!value || typeof value !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    for (var property in value) {
      if (!Object.prototype.hasOwnProperty.call(value, property)) continue;
      var found = findNested(value[property], key);
      if (found) return found;
    }
    return null;
  }
  function textFromRuns(runs) {
    return (runs || []).map(function(run) { return run && run.text || ''; }).join('').replace(/\s+/g, ' ').trim();
  }
  function innertubeConfig() {
    var config = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
    var clientVersion = config && (config.get('INNERTUBE_CLIENT_VERSION') || config.get('INNERTUBE_CONTEXT_CLIENT_VERSION'));
    var visitorData = config && config.get('VISITOR_DATA');
    return { clientVersion: clientVersion || '', visitorData: visitorData || '' };
  }
  async function postInnertube(path, body) {
    var config = innertubeConfig();
    if (!config.clientVersion) throw new Error('YouTube 页面接口尚未就绪');
    var headers = { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': config.clientVersion };
    if (config.visitorData) headers['X-Goog-Visitor-Id'] = config.visitorData;
    var response = await fetch('https://www.youtube.com/youtubei/v1/' + path + '?prettyPrint=false', {
      method: 'POST', headers: headers, body: JSON.stringify(body), credentials: 'include', cache: 'no-store'
    });
    if (!response.ok) throw new Error('YouTube 页面文字稿请求失败（HTTP ' + response.status + '）');
    return response.json();
  }
  async function fetchInnertubeTranscript(videoId) {
    var config = innertubeConfig();
    var context = { client: { clientName: 'WEB', clientVersion: config.clientVersion, hl: document.documentElement && document.documentElement.lang || 'zh-CN', visitorData: config.visitorData } };
    var next = await postInnertube('next', { context: context, videoId: videoId });
    var endpoint = findNested(next, 'getTranscriptEndpoint');
    if (!endpoint || !endpoint.params) throw new Error('该视频没有可用页面文字稿');
    var transcript = await postInnertube('get_transcript', { context: context, params: endpoint.params });
    var renderer = findNested(transcript, 'transcriptSegmentListRenderer');
    return (renderer && renderer.initialSegments || []).map(function(item) {
      var segment = item && item.transcriptSegmentRenderer;
      if (!segment) return null;
      var start = Number(segment.startMs || 0) / 1000;
      var end = Number(segment.endMs || segment.startMs || 0) / 1000;
      return { start: start, duration: Math.max(0, end - start), text: textFromRuns(segment.snippet && segment.snippet.runs) };
    }).filter(function(segment) { return segment && segment.text; });
  }
  return (async function() {
    try {
      var requestedId = expected && expected.id || new URL(location.href).searchParams.get('v') || '';
      if (!requestedId) return { error: '无法从 URL 确定 YouTube 视频 ID' };
      var player = null;
      for (var attempt = 0; attempt < 6; attempt++) {
        var candidate = selectMatchingPlayerResponse(getPlayerResponseCandidates(), requestedId);
        if (candidate) player = candidate;
        if (candidate && pick(captionTracks(candidate))) break;
        if (attempt < 5) await wait(200);
      }
      var details = player && player.videoDetails || {};
      if (String(details.videoId || '') !== String(requestedId)) return { error: 'YouTube 页面播放器 ID 与请求视频不一致，请重试' };
      var tracks = orderedTracks(captionTracks(player));
      if (!tracks.length) return { error: '该 YouTube 视频没有可用字幕' };
      var track = null, segments = null;
      for (var trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        try {
          var candidateSegments = await fetchCaptionSegments(tracks[trackIndex].baseUrl);
          if (candidateSegments.length) { track = tracks[trackIndex]; segments = candidateSegments; break; }
        } catch (_) {}
      }
      if (!segments) {
        try { segments = await fetchInnertubeTranscript(requestedId); } catch (_) {}
      }
      if (!segments || !segments.length) return { error: '该 YouTube 视频当前没有可读取的字幕或页面文字稿' };
      return { platform: 'YouTube', videoId: details.videoId, title: details.title || document.title.replace(/ - YouTube$/, ''), channel: details.author || '', url: location.href, language: track && (track.name && track.name.simpleText || track.languageCode) || 'YouTube 页面文字稿', segments: segments, source: { requestedUrl: expected && expected.url || location.href, playerVideoId: details.videoId, trackUrl: track && track.baseUrl || '', transcriptFallback: !track } };
    } catch (error) { return { error: error.message || 'YouTube 字幕提取失败' }; }
  })();
}

function extractBilibiliInMainWorld(expected) {
  function md5(value) {
    function add(x, y) { var l = (x & 65535) + (y & 65535), h = (x >>> 16) + (y >>> 16) + (l >>> 16); return (h << 16) | (l & 65535); }
    function left(x, s) { return (x << s) | (x >>> (32 - s)); }
    function cmn(q, a, b, x, s, t) { return add(left(add(add(a, q), add(x, t)), s), b); }
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);} function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);} function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);} function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
    var bytes = unescape(encodeURIComponent(value)), words = [], i; for (i=0;i<bytes.length;i++) words[i>>2] = (words[i>>2] || 0) | (bytes.charCodeAt(i) << ((i%4)*8));
    var bit = bytes.length * 8; words[bit>>5] = (words[bit>>5] || 0) | (128 << (bit%32)); words[(((bit+64)>>>9)<<4)+14] = bit;
    var a=1732584193,b=-271733879,c=-1732584194,d=271733878;
    for(i=0;i<words.length;i+=16){var oa=a,ob=b,oc=c,od=d;
      a=ff(a,b,c,d,words[i]||0,7,-680876936);d=ff(d,a,b,c,words[i+1]||0,12,-389564586);c=ff(c,d,a,b,words[i+2]||0,17,606105819);b=ff(b,c,d,a,words[i+3]||0,22,-1044525330);a=ff(a,b,c,d,words[i+4]||0,7,-176418897);d=ff(d,a,b,c,words[i+5]||0,12,1200080426);c=ff(c,d,a,b,words[i+6]||0,17,-1473231341);b=ff(b,c,d,a,words[i+7]||0,22,-45705983);a=ff(a,b,c,d,words[i+8]||0,7,1770035416);d=ff(d,a,b,c,words[i+9]||0,12,-1958414417);c=ff(c,d,a,b,words[i+10]||0,17,-42063);b=ff(b,c,d,a,words[i+11]||0,22,-1990404162);a=ff(a,b,c,d,words[i+12]||0,7,1804603682);d=ff(d,a,b,c,words[i+13]||0,12,-40341101);c=ff(c,d,a,b,words[i+14]||0,17,-1502002290);b=ff(b,c,d,a,words[i+15]||0,22,1236535329);
      a=gg(a,b,c,d,words[i+1]||0,5,-165796510);d=gg(d,a,b,c,words[i+6]||0,9,-1069501632);c=gg(c,d,a,b,words[i+11]||0,14,643717713);b=gg(b,c,d,a,words[i]||0,20,-373897302);a=gg(a,b,c,d,words[i+5]||0,5,-701558691);d=gg(d,a,b,c,words[i+10]||0,9,38016083);c=gg(c,d,a,b,words[i+15]||0,14,-660478335);b=gg(b,c,d,a,words[i+4]||0,20,-405537848);a=gg(a,b,c,d,words[i+9]||0,5,568446438);d=gg(d,a,b,c,words[i+14]||0,9,-1019803690);c=gg(c,d,a,b,words[i+3]||0,14,-187363961);b=gg(b,c,d,a,words[i+8]||0,20,1163531501);a=gg(a,b,c,d,words[i+13]||0,5,-1444681467);d=gg(d,a,b,c,words[i+2]||0,9,-51403784);c=gg(c,d,a,b,words[i+7]||0,14,1735328473);b=gg(b,c,d,a,words[i+12]||0,20,-1926607734);
      a=hh(a,b,c,d,words[i+5]||0,4,-378558);d=hh(d,a,b,c,words[i+8]||0,11,-2022574463);c=hh(c,d,a,b,words[i+11]||0,16,1839030562);b=hh(b,c,d,a,words[i+14]||0,23,-35309556);a=hh(a,b,c,d,words[i+1]||0,4,-1530992060);d=hh(d,a,b,c,words[i+4]||0,11,1272893353);c=hh(c,d,a,b,words[i+7]||0,16,-155497632);b=hh(b,c,d,a,words[i+10]||0,23,-1094730640);a=hh(a,b,c,d,words[i+13]||0,4,681279174);d=hh(d,a,b,c,words[i]||0,11,-358537222);c=hh(c,d,a,b,words[i+3]||0,16,-722521979);b=hh(b,c,d,a,words[i+6]||0,23,76029189);a=hh(a,b,c,d,words[i+9]||0,4,-640364487);d=hh(d,a,b,c,words[i+12]||0,11,-421815835);c=hh(c,d,a,b,words[i+15]||0,16,530742520);b=hh(b,c,d,a,words[i+2]||0,23,-995338651);
      a=ii(a,b,c,d,words[i]||0,6,-198630844);d=ii(d,a,b,c,words[i+7]||0,10,1126891415);c=ii(c,d,a,b,words[i+14]||0,15,-1416354905);b=ii(b,c,d,a,words[i+5]||0,21,-57434055);a=ii(a,b,c,d,words[i+12]||0,6,1700485571);d=ii(d,a,b,c,words[i+3]||0,10,-1894986606);c=ii(c,d,a,b,words[i+10]||0,15,-1051523);b=ii(b,c,d,a,words[i+1]||0,21,-2054922799);a=ii(a,b,c,d,words[i+8]||0,6,1873313359);d=ii(d,a,b,c,words[i+15]||0,10,-30611744);c=ii(c,d,a,b,words[i+6]||0,15,-1560198380);b=ii(b,c,d,a,words[i+13]||0,21,1309151649);a=ii(a,b,c,d,words[i+4]||0,6,-145523070);d=ii(d,a,b,c,words[i+11]||0,10,-1120210379);c=ii(c,d,a,b,words[i+2]||0,15,718787259);b=ii(b,c,d,a,words[i+9]||0,21,-343485551);a=add(a,oa);b=add(b,ob);c=add(c,oc);d=add(d,od);}
    function hex(n){var s='';for(var j=0;j<4;j++)s+=('0'+((n >>> (j*8))&255).toString(16)).slice(-2);return s;} return hex(a)+hex(b)+hex(c)+hex(d);
  }
  return (async function() {
    try {
      var state = window.__INITIAL_STATE__ || {};
      var pageVideo = state.videoData || {};
      var targetBvid = expected && expected.id || new URL(location.href).pathname.split('/').filter(Boolean).pop();
      if (!/^BV[0-9A-Za-z]+$/i.test(targetBvid || '')) return { error: '无法从 URL 确定 B站 BV 号' };
      if (pageVideo.bvid && String(pageVideo.bvid).toLowerCase() !== String(targetBvid).toLowerCase()) return { error: '页面视频 BV 号与请求 URL 不一致，已拒绝使用可能过期的页面状态' };
      var p = Number(new URL(location.href).searchParams.get('p') || 1);
      if (!Number.isInteger(p) || p < 1) return { error: 'B站分 P 参数无效' };
      var headers = { 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com' };
      // Do not trust __INITIAL_STATE__ alone: Bilibili can leave stale player
      // state during SPA navigation.  Resolve this exact BV URL again, then use
      // its exact aid/cid pair for the subtitle API.
      var view = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(targetBvid), { headers: headers, credentials: 'include' }).then(function(r) { return r.json(); });
      if (view.code !== 0 || !view.data) throw new Error(view.message || '无法核对 B站视频元数据');
      var video = view.data;
      if (String(video.bvid || '').toLowerCase() !== String(targetBvid).toLowerCase()) throw new Error('B站元数据返回的 BV 号与请求不一致，已拒绝返回字幕');
      var page = (video.pages || [])[p - 1];
      if (!page || !page.cid || !video.aid) throw new Error('请求的视频分 P 不存在或没有有效 cid');
      var aid = video.aid, cid = page.cid;
      if (pageVideo.aid && Number(pageVideo.aid) !== Number(aid)) throw new Error('页面 aid 与 URL 对应视频不一致，已拒绝返回字幕');
      var nav = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: headers, credentials: 'include' }).then(function(r){return r.json();});
      if (nav.code !== 0) throw new Error(nav.message || '无法获取 B站登录状态');
      var img = nav.data.wbi_img.img_url.split('/').pop().split('.')[0], sub = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];
      var tab = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
      var raw = img + sub, mixin = tab.map(function(i){return raw[i];}).join('').slice(0,32), params={aid:aid,cid:cid,wts:Math.floor(Date.now()/1000)};
      var query=Object.keys(params).sort().map(function(key){return key+'='+params[key];}).join('&');
      var result = await fetch('https://api.bilibili.com/x/player/wbi/v2?' + query + '&w_rid=' + md5(query + mixin), {headers:headers,credentials:'include'}).then(function(r){return r.json();});
      if (result.code !== 0) result = await fetch('https://api.bilibili.com/x/player/v2?aid='+aid+'&cid='+cid,{headers:headers,credentials:'include'}).then(function(r){return r.json();});
      if (result.code !== 0) throw new Error(result.message || 'B站字幕接口请求失败');
      var tracks = result.data && result.data.subtitle && result.data.subtitle.subtitles || [];
      var chosen = tracks.find(function(track){return track.ai_status === 1;}) || tracks.find(function(track){return /^zh/i.test(track.lan || '');}) || tracks[0];
      if (!chosen || !chosen.subtitle_url) return { error: '该 B站视频没有可用字幕' };
      var subtitleUrl = chosen.subtitle_url.indexOf('//') === 0 ? 'https:' + chosen.subtitle_url : chosen.subtitle_url;
      // Subtitle JSON is commonly served by an hdslb CDN.  It permits a normal
      // cross-origin request but rejects credentialed CORS requests, so only
      // the Bilibili metadata/WBI calls above reuse the page login session.
      var subtitle = await fetch(subtitleUrl, {headers:headers}).then(function(r){return r.json();});
      var segments=(subtitle.body || []).map(function(item){return {start:item.from,end:item.to,text:(item.content||'').replace(/\n/g,' ')};}).filter(function(item){return item.text;});
      if (!segments.length) return { error: '字幕内容为空' };
      return {platform:'Bilibili',videoId:video.bvid,title:video.title || document.title,channel:video.owner && video.owner.name || '',url:location.href,language:chosen.lan_doc || chosen.lan || 'unknown',segments:segments,source:{requestedUrl:expected && expected.url || location.href,bvid:video.bvid,aid:aid,cid:cid,page:p,subtitleUrl:subtitleUrl}};
    } catch(error) { return { error: error.message || 'B站字幕提取失败' }; }
  })();
}
