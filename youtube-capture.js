// Runs in YouTube's MAIN world at document_start. It never makes a caption
// request: it passively copies the exact response the player already uses.
(function() {
  'use strict';
  var MESSAGE_SOURCE = 'vidgist-youtube-caption-capture';
  var REQUEST_SOURCE = 'vidgist-youtube-caption-request';
  var lastFingerprint = '';
  var lastCapture = null;
  var replayedUrls = {};

  function videoIdFromUrl(url) {
    try { return new URL(url, location.href).searchParams.get('v') || new URL(url, location.href).pathname.split('/')[2] || ''; } catch (_) { return ''; }
  }
  function decodeHtml(value) {
    var area = document.createElement('textarea');
    area.innerHTML = String(value || '');
    return area.value;
  }
  function attribute(text, name) {
    var match = String(text || '').match(new RegExp('\\b' + name + '=["\\\']([^"\\\']*)["\\\']', 'i'));
    return match ? match[1] : '';
  }
  function parseXml(text) {
    var cues = [], match, pattern = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((match = pattern.exec(String(text || '')))) {
      var paragraph = match[1].toLowerCase() === 'p';
      var start = Number(attribute(match[2], paragraph ? 't' : 'start'));
      var duration = Number(attribute(match[2], paragraph ? 'd' : 'dur'));
      if (paragraph) { start /= 1000; duration /= 1000; }
      var cueText = decodeHtml(match[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (Number.isFinite(start) && cueText) cues.push({ start: start, duration: Number.isFinite(duration) ? Math.max(0, duration) : 0, text: cueText });
    }
    return cues;
  }
  function parsePayload(body) {
    body = String(body || '').trim();
    if (!body) return [];
    if (body.charAt(0) === '{') {
      try {
        return (JSON.parse(body).events || []).map(function(event) {
          return { start: (event.tStartMs || 0) / 1000, duration: (event.dDurationMs || 0) / 1000, text: (event.segs || []).map(function(item) { return item.utf8 || ''; }).join('').replace(/\s+/g, ' ').trim() };
        }).filter(function(cue) { return cue.text; });
      } catch (_) { return []; }
    }
    return parseXml(body);
  }
  function capture(url, body) {
    if (!url || String(url).indexOf('/api/timedtext') === -1) return;
    var cues = parsePayload(body);
    if (!cues.length) return;
    var parsed = new URL(url, location.href);
    var id = parsed.searchParams.get('v') || videoIdFromUrl(location.href);
    if (!id || id !== videoIdFromUrl(location.href)) return;
    var fingerprint = id + ':' + cues.length + ':' + cues[0].text;
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    lastCapture = { source: MESSAGE_SOURCE, videoId: id, language: parsed.searchParams.get('lang') || '', segments: cues };
    window.postMessage(lastCapture, location.origin);
  }
  function observeFetch() {
    var original = window.fetch;
    if (typeof original !== 'function') return;
    window.fetch = function() {
      var request = arguments[0];
      var url = typeof request === 'string' ? request : request && request.url;
      var result = original.apply(this, arguments);
      Promise.resolve(result).then(function(response) {
        if (!url || String(url).indexOf('/api/timedtext') === -1 || !response || !response.clone) return;
        response.clone().text().then(function(body) { capture(url, body); }).catch(function() {});
      }).catch(function() {});
      return result;
    };
  }
  function observeXhr() {
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) { this.__vidgistTimedtextUrl = url; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        try { capture(this.__vidgistTimedtextUrl, this.responseType && this.responseType !== 'text' ? '' : this.responseText); } catch (_) {}
      });
      return send.apply(this, arguments);
    };
  }
  function replayPlayerTimedtext(url) {
    if (!url || replayedUrls[url]) return;
    replayedUrls[url] = true;
    // Resource Timing gives us the request made by the player itself, including
    // its short-lived proof-of-origin token. Replaying that exact URL is only a
    // fallback for transports that bypass fetch/XHR interception.
    window.fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function(response) {
      return response.text();
    }).then(function(body) { capture(url, body); }).catch(function() {});
  }
  function observeResources() {
    function inspect(entries) {
      entries.forEach(function(entry) {
        if (entry && entry.name && String(entry.name).indexOf('/api/timedtext') !== -1) replayPlayerTimedtext(entry.name);
      });
    }
    try {
      inspect(performance.getEntriesByType('resource'));
      if (typeof PerformanceObserver === 'function') {
        var observer = new PerformanceObserver(function(list) { inspect(list.getEntries()); });
        observer.observe({ type: 'resource', buffered: true });
      }
    } catch (_) {}
  }
  observeFetch();
  observeXhr();
  observeResources();
  window.addEventListener('message', function(event) {
    if (event.source === window && event.data && event.data.source === REQUEST_SOURCE && lastCapture) window.postMessage(lastCapture, location.origin);
  });
})();
