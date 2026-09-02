/* global chrome, VideoSummaryShared */
(function() {
  'use strict';
  var Shared = VideoSummaryShared, video = null, summary = '', prompts = [], presets = [], preferences = { summaryFontSize: 18, selectedPromptValue: 'preset:overview' };
  var $ = function(id) { return document.getElementById(id); };
  function message(payload) { return new Promise(function(resolve) { chrome.runtime.sendMessage(payload, function(response) { resolve(response || { error: chrome.runtime.lastError && chrome.runtime.lastError.message || '扩展通信失败' }); }); }); }
  function setStatus(text, error) { var el = $('status'); el.textContent = text; el.className = 'status' + (error ? ' error' : ''); }
  function filename(suffix) { return '视频字幕/' + Shared.safeFilename(video.title) + suffix + '.md'; }
  function currentValue() { return $('promptSelect').value; }
  function applyFontSize(value) {
    var size = Shared.normalizeFontSize(value);
    preferences.summaryFontSize = size;
    document.documentElement.style.setProperty('--summary-font-size', size + 'px');
    $('fontSize').value = String(size);
    $('fontSizeValue').textContent = size + 'px';
  }
  function persistPreferences(changes) {
    Object.assign(preferences, changes || {});
    return message({ type: 'savePreferences', summaryFontSize: preferences.summaryFontSize, selectedPromptValue: preferences.selectedPromptValue });
  }
  function selectedCustomPrompt() { var value = currentValue(); return value.indexOf('custom:') === 0 ? prompts.find(function(item) { return item.id === value.slice(7); }) || null : null; }
  function choice() {
    var value = currentValue(), custom = selectedCustomPrompt(), presetId = value.indexOf('preset:') === 0 ? value.slice(7) : 'overview';
    var extra = custom ? custom.content : $('promptText').value.trim();
    return { presetId: presetId, customPrompt: extra, name: $('promptSelect').selectedOptions[0].textContent + (extra && !custom ? ' + 自定义要求' : '') };
  }
  function renderPrompts() {
    var select = $('promptSelect'), selected = select.value || preferences.selectedPromptValue;
    select.replaceChildren();
    var builtins = document.createElement('optgroup'); builtins.label = '内置提示词';
    presets.forEach(function(preset) { var option = document.createElement('option'); option.value = 'preset:' + preset.id; option.textContent = preset.name; builtins.appendChild(option); });
    select.appendChild(builtins);
    if (prompts.length) {
      var customs = document.createElement('optgroup'); customs.label = '已保存的自定义提示词';
      prompts.forEach(function(prompt) { var option = document.createElement('option'); option.value = 'custom:' + prompt.id; option.textContent = prompt.name; customs.appendChild(option); });
      select.appendChild(customs);
    }
    select.value = Array.from(select.options).some(function(option) { return option.value === selected; }) ? selected : 'preset:overview';
    preferences.selectedPromptValue = select.value;
  }
  function renderTimestampText(container, text) {
    container.replaceChildren();
    var cursor = 0;
    Shared.findTimestamps(text).forEach(function(match) {
      container.append(document.createTextNode(text.slice(cursor, match.index)));
      var button = document.createElement('button'); button.type = 'button'; button.className = 'timestamp'; button.textContent = match.token;
      button.addEventListener('click', function() { seek(match.seconds); }); container.append(button); cursor = match.end;
    });
    container.append(document.createTextNode(text.slice(cursor)));
  }
  async function seek(seconds) {
    var result = await message({ type: 'seekToTimestamp', seconds: seconds });
    setStatus(result.error || ('已跳转到 ' + Shared.formatTimestamp(seconds) + '。'), Boolean(result.error));
  }
  async function loadPrompts() { var result = await message({ type: 'getPrompts' }); presets = result.presets || []; prompts = result.prompts || []; renderPrompts(); }
  async function loadPreferences() { var result = await message({ type: 'getPreferences' }); if (!result.error) { preferences = result; applyFontSize(preferences.summaryFontSize); } }
  async function loadSettings() { var result = await message({ type: 'getSettings' }); $('model').value = result.model || 'deepseek-v4-flash'; $('keyStatus').textContent = result.hasApiKey ? '已保存 API Key。' : '尚未保存 API Key。'; }
  async function refresh() {
    video = null; summary = ''; $('app').hidden = true; $('summarySection').hidden = true; setStatus('正在获取当前视频字幕…');
    var result = await message({ type: 'getTranscript' });
    if (result.error) { setStatus(result.error, true); return; }
    video = result.video; $('title').textContent = video.title; $('meta').textContent = video.platform + ' · ' + (video.channel || '未知频道') + ' · ' + video.language + ' · ' + video.segments.length + ' 段'; renderTimestampText($('transcript'), video.text); $('app').hidden = false; setStatus('字幕已获取，可生成总结、复制或下载。');
  }
  $('refresh').addEventListener('click', refresh);
  $('openSettings').addEventListener('click', function() { $('settingsDialog').showModal(); });
  $('fontSize').addEventListener('input', function() { applyFontSize($('fontSize').value); persistPreferences(); });
  $('copy').addEventListener('click', async function() { try { await navigator.clipboard.writeText(video.text); setStatus('已复制全部字幕。'); } catch (_) { setStatus('复制失败，请检查剪贴板权限。', true); } });
  $('downloadTranscript').addEventListener('click', async function() { var result = await message({ type: 'download', filename: filename('_字幕'), text: Shared.markdownForTranscript(video) }); setStatus(result.error || '已打开保存位置。', Boolean(result.error)); });
  $('promptSelect').addEventListener('change', function() { var prompt = selectedCustomPrompt(); $('promptName').value = prompt ? prompt.name : ''; $('promptText').value = prompt ? prompt.content : ''; persistPreferences({ selectedPromptValue: currentValue() }); });
  $('savePrompt').addEventListener('click', async function() {
    var current = selectedCustomPrompt(); var result = await message({ type: 'savePrompt', prompt: { id: current && current.id, name: $('promptName').value, content: $('promptText').value } });
    if (result.error) return setStatus(result.error, true); prompts = result.prompts; renderPrompts(); var saved = prompts.find(function(prompt) { return prompt.name === $('promptName').value.trim(); }); if (saved) { $('promptSelect').value = 'custom:' + saved.id; persistPreferences({ selectedPromptValue: $('promptSelect').value }); } setStatus('提示词已保存。');
  });
  $('deletePrompt').addEventListener('click', async function() { var current = selectedCustomPrompt(); if (!current) return setStatus('请先选择一个已保存的自定义提示词。', true); var result = await message({ type: 'deletePrompt', id: current.id }); if (result.error) return setStatus(result.error, true); prompts = result.prompts; renderPrompts(); persistPreferences({ selectedPromptValue: $('promptSelect').value }); $('promptName').value = ''; $('promptText').value = ''; setStatus('提示词已删除。'); });
  $('summarize').addEventListener('click', async function() {
    if (!video) return; var selected = choice(); $('summarize').disabled = true; setStatus('DeepSeek 正在生成总结…');
    var result = await message({ type: 'summarize', video: video, presetId: selected.presetId, customPrompt: selected.customPrompt }); $('summarize').disabled = false;
    if (result.error) return setStatus(result.error, true); summary = result.summary; renderTimestampText($('summary'), summary); $('summarySection').hidden = false; setStatus('总结已生成；点击任意时间戳可跳转视频。');
  });
  $('downloadSummary').addEventListener('click', async function() { var result = await message({ type: 'download', filename: filename('_字幕与总结'), text: Shared.markdownForSummary(video, summary, choice().name) }); setStatus(result.error || '已打开保存位置。', Boolean(result.error)); });
  $('saveSettings').addEventListener('click', async function(event) { event.preventDefault(); var result = await message({ type: 'saveSettings', apiKey: $('apiKey').value, model: $('model').value }); if (result.error) return setStatus(result.error, true); $('apiKey').value = ''; $('keyStatus').textContent = result.hasApiKey ? '已保存 API Key。' : '尚未保存 API Key。'; $('settingsDialog').close(); setStatus('DeepSeek 设置已保存。'); });
  $('clearKey').addEventListener('click', async function() { var result = await message({ type: 'saveSettings', clearApiKey: true, model: $('model').value }); if (result.error) return setStatus(result.error, true); $('apiKey').value = ''; $('keyStatus').textContent = '尚未保存 API Key。'; setStatus('API Key 已清除。'); });
  chrome.runtime.onMessage.addListener(function(request) { if (request.type === 'videoContextChanged') refresh(); });
  Promise.all([loadPreferences().then(loadPrompts), loadSettings()]).then(refresh);
})();
