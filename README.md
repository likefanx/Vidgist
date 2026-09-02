# Vidgist（Edge）

本地 Edge Manifest V3 扩展：提取 B站或 YouTube 的视频字幕、复制/下载 Markdown，并用 DeepSeek API 生成中文总结。它也可经本机 Native Messaging 桥接，供 AI 和外部程序批量调用。

内置三种总结方式：概览与时间线、分段总结、极简速览。摘要和字幕中的 `[MM:SS]` / `[HH:MM:SS]` 时间戳可点击跳转到视频对应位置；DeepSeek 设置收纳在侧边栏右上角的“设置”按钮中。

## 安装

1. 在 Edge 打开 `edge://extensions`，启用“开发人员模式”。
2. 选择“加载解压缩的扩展”，选择本项目目录。
3. 将扩展固定到工具栏；打开 B站或 YouTube 视频后点击图标。
4. 在侧边栏“DeepSeek 设置”中粘贴 API Key。Key 仅保存在本机的扩展存储中。

YouTube 字幕提取使用页面内的浏览器捕获器：它观察当前播放器真实发出的字幕请求，并在侧边栏打开后读取已缓存的字幕。因此不需要把 YouTube 字幕交给 Python、yt-dlp 或远程服务。修改代码后请在 `edge://extensions` 重新加载扩展，并刷新 YouTube 页面，让 `document_start` 捕获器从页面最早阶段开始工作。

## 供 AI / 程序批量调用

浏览器扩展始终在已登录的浏览器会话中提取字幕；本机桥接只在 `127.0.0.1` 上接收 URL、返回字幕结果，**不会读取、保存或导出 Cookie**。

1. 按上面的步骤加载此扩展，在扩展卡片上复制它的 ID。
2. 在 PowerShell 运行一次（Edge 用户可传 `-Browser Edge`）：

```powershell
cd D:\AIWorks\AICodeProjects\Vidgist\native_host
.\install_native_host.ps1 -ExtensionId '在 edge://extensions 复制的 32 位 ID' -Browser Edge
```

3. 回到 `edge://extensions` 重新加载 Vidgist。之后，AI 或任意本机程序都可以调用：

```powershell
python D:\AIWorks\AICodeProjects\Vidgist\native_host\vidgist_subtitles.py extract `
  'https://www.bilibili.com/video/BV1xxxxxxxxx/' `
  'https://www.youtube.com/watch?v=xxxxxxxxxxx' `
  --wait --output D:\Subtitles
```


标准输出为完整 JSON（包含平台、视频元数据、时间戳字幕和 Markdown）；`--output` 会额外按视频写出 Markdown 文件。也可以不等待，获取任务 ID 后查询：

```powershell
python D:\AIWorks\AICodeProjects\Vidgist\native_host\vidgist_subtitles.py status '任务 ID'
```

本地 HTTP API 位于运行时文件 `%LOCALAPPDATA%\VidgistSubtitleBridge\runtime.json` 中标明的端口，使用该文件中的 Bearer Token：

```text
POST /v1/jobs       {"videos":["<B站或 YouTube 视频 URL>", ...]}
GET  /v1/jobs/{id}
GET  /v1/health
```

### B站正确性校验

对每个 B站 URL，扩展会先按 URL 中的 BV 号重新获取视频元数据，校验 BV 号、aid、请求分 P 的 cid 与页面状态一致，再用这个准确的 aid/cid 获取字幕轨道。若任何标识不一致，任务会失败并拒绝返回字幕，而不会把可能来自其他视频的内容作为结果。

## 验证

在本目录运行：

```powershell
npm test
```

无可用字幕的视频会明确显示提示；工具不会下载音频或进行语音转写，只返回平台提供的字幕。
