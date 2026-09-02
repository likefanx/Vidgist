# Vidgist

> 一个轻量的 Microsoft Edge 侧边栏扩展：读取 Bilibili 和 YouTube 视频字幕，用 DeepSeek 生成可追踪时间戳的中文总结。

Vidgist 面向需要快速阅读长视频的人。打开视频后，点击工具栏中的 Vidgist 图标，即可在侧边栏中获取字幕、复制全文、生成总结并下载 Markdown 笔记。

## 功能亮点

- 支持 Bilibili 和 YouTube 视频页面
- 一键获取当前视频的完整字幕，并复制到剪贴板
- 内置三种总结方式：概览与时间线、分段总结、极简速览
- 支持保存、修改和删除自定义提示词
- 使用 DeepSeek API 生成中文 Markdown 总结
- 总结和字幕中的时间戳可点击，直接跳转到视频对应位置
- 可调节总结字号，并自动保存偏好设置
- 下载“仅字幕”或“字幕 + 总结”Markdown 文件
- 支持通过可选的 Native Messaging 接口供本地程序批量调用

## 工作方式

### YouTube

Vidgist 在 YouTube 页面最早阶段注入浏览器脚本，观察当前播放器真实发出的字幕请求，并解析播放器返回的 JSON3、XML 或 SRV 字幕数据。

这种方式可以处理部分静态字幕地址返回空内容、但视频播放器实际能够显示字幕的情况。字幕提取完全在浏览器中进行，不依赖 Python、yt-dlp、音频下载或语音转写服务。

### Bilibili

Vidgist 使用当前 Edge 登录态读取视频信息和字幕轨道，并校验 BV 号、aid、cid 等视频标识，避免页面切换后误读其他视频的字幕。

### DeepSeek

只有点击“生成总结”后，字幕和选中的提示词才会发送到 DeepSeek API。API Key 保存在浏览器扩展的本地存储中，不写入 Markdown 文件、网页 DOM 或日志。

## 安装

Vidgist 当前以“加载解压缩的扩展”方式安装：

1. 在 Microsoft Edge 打开 `edge://extensions`。
2. 开启右上角的“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目目录。
5. 将 Vidgist 固定到工具栏。
6. 打开一个 Bilibili 或 YouTube 视频，点击 Vidgist 图标。
7. 第一次使用总结功能时，在侧边栏“设置”中填写 DeepSeek API Key。

修改扩展代码后，请在 `edge://extensions` 点击“重新加载”，并刷新视频页面。YouTube 字幕捕获器需要在页面最早阶段注入才能可靠观察播放器请求。

## 使用流程

1. 打开支持的 Bilibili 或 YouTube 视频。
2. 点击工具栏中的 Vidgist，等待字幕加载。
3. 点击“复制全部字幕”或展开字幕查看区域。
4. 选择总结方式，点击“生成总结”。
5. 点击总结中的时间戳跳转到视频位置。
6. 使用下载按钮保存字幕或字幕与总结 Markdown。

## 项目结构

```text
Vidgist/
├── manifest.json          # Edge Manifest V3 配置
├── background.js          # 字幕获取、DeepSeek 请求和视频跳转
├── content.js             # 页面与扩展之间的消息桥接
├── youtube-capture.js     # YouTube MAIN world 字幕请求捕获器
├── sidepanel.html/js/css  # 侧边栏界面与 Markdown 渲染
├── shared.js              # 字幕、时间戳、提示词和导出公共逻辑
├── test/                  # Node 内置测试
└── native_host/           # 可选的本地批量调用接口
```

## 开发与测试

项目不依赖前端构建工具，直接加载源代码即可开发。运行测试：

```powershell
cd D:\AIWorks\AICodeProjects\Vidgist
npm test
```

## 可选：本地批量调用

浏览器扩展本身始终使用已登录的 Edge 会话提取字幕。`native_host` 是独立的可选功能，只在本机 `127.0.0.1` 接收任务，不读取、保存或导出浏览器 Cookie。

安装本地桥接：

```powershell
cd D:\AIWorks\AICodeProjects\Vidgist\native_host
.\install_native_host.ps1 -ExtensionId 'edge://extensions 中的扩展 ID' -Browser Edge
```

批量提取示例：

```powershell
python D:\AIWorks\AICodeProjects\Vidgist\native_host\vidgist_subtitles.py extract `
  'https://www.bilibili.com/video/BV1xxxxxxxxx/' `
  'https://www.youtube.com/watch?v=xxxxxxxxxxx' `
  --wait --output D:\Subtitles
```

## 限制

- 只支持平台提供的字幕，无法识别烧录在视频画面中的字幕。
- 没有字幕时不会自动下载音频或进行语音转写。
- 第一版不包含频道批量处理、云端历史记录或跨设备同步。
- DeepSeek API 的可用模型、额度和费用由 DeepSeek 账户决定。

## 隐私与安全

- API Key 只保存在本地 `chrome.storage.local` 中。
- API Key 不会写入下载文件，也不会发送给 Bilibili、YouTube 或本项目服务器。
- 项目没有内置后端服务器；普通字幕提取直接在浏览器内完成。
- 使用 DeepSeek 总结时，视频字幕会发送到 `api.deepseek.com`。

## License

当前项目尚未指定开源许可证。未经许可，请不要将代码用于再发布或商业分发。
