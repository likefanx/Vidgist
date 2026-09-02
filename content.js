(function() {
  'use strict';
  var capturedYouTubeTranscript = null;
  function notify() { chrome.runtime.sendMessage({ type: 'pageChanged' }, function() { void chrome.runtime.lastError; }); }
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (event.source !== window || !data || data.source !== 'vidgist-youtube-caption-capture') return;
    if (!Array.isArray(data.segments) || !data.segments.length || String(data.videoId || '') !== new URL(location.href).searchParams.get('v')) return;
    capturedYouTubeTranscript = { videoId: data.videoId, language: String(data.language || ''), segments: data.segments };
  });
  chrome.runtime.onMessage.addListener(function(request, _sender, sendResponse) {
    if (request.type !== 'getCapturedYouTubeTranscript') return;
    if (capturedYouTubeTranscript) { sendResponse(capturedYouTubeTranscript); return; }
    window.postMessage({ source: 'vidgist-youtube-caption-request' }, location.origin);
    setTimeout(function() { sendResponse(capturedYouTubeTranscript); }, 50);
    return true;
  });
  notify();
  window.addEventListener('yt-navigate-finish', notify);
  var previous = location.href;
  setInterval(function() {
    if (location.href !== previous) { previous = location.href; notify(); }
  }, 750);
})();
