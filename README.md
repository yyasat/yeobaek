# 여백 · 留白

低饱和浅蓝的安静浏览器外壳。单文件前端 + Capacitor 原生桥，GitHub Actions 直接产出 APK。

## 目录

```
index.html                     单页外壳
manifest.webmanifest           PWA 声明（display: standalone / fullscreen）
capacitor.config.json          原生容器配置
assets/css/tokens.css          六套低饱和浅蓝主题 + 间距/圆角/字号刻度
assets/css/app.css             全部布局与组件
assets/js/store.js             IndexedDB 持久化 + localStorage 镜像 + 配额
assets/js/metadata.js          网址规范化、标题抓取、图标回退
assets/js/native.js            原生桥（浏览器自动降级）
assets/js/tabs.js              标签页 / 网页层 / 缩放 / 注入
assets/js/ai.js                一句话 → 控制台代码
assets/js/app.js               主控
native/android/*.java          沉浸式全屏、桌面图标、数据清除
.github/workflows/build-apk.yml 打包流水线
```

## 打包成 APK

推到 `main` 分支即触发 Actions，产物在运行页面的 **Artifacts → yeobaek-debug-apk**。
本地构建（需要 Node 20 + JDK 21 + Android SDK）：

```bash
npm install
npx cap add android
cp native/android/*.java android/app/src/main/java/com/yeobaek/browser/
npx cap sync android
cd android && ./gradlew assembleDebug
```

## 关于「系统级」那几条需求

| 需求 | 实现方式 | 说明 |
|---|---|---|
| 挤掉状态栏、内容延伸到状态栏下方 | `WindowCompat.setDecorFitsSystemWindows(false)` + 栏底透明 | 系统栏图标仍在（否则时间/电量不可读），但底色由网页决定，每次换主题都会延伸过去 |
| 状态栏字色自适应 | `setAppearanceLightStatusBars()` 按底色亮度切换 | 前端用 WCAG 相对亮度算 `darkIcons` |
| 持久化存储、不被清 | `navigator.storage.persist()` + IndexedDB | 系统在空间不足时不会优先清理；只有手动「清除数据」会删 |
| Chrome 内部空间分配 | IndexedDB 不参与 HTTP 缓存配额淘汰 | 网页缓存仍受系统管理，这一层无法越权 |
| 桌面快捷方式、自动取名取图标 | `ShortcutManager.requestPinShortcut` + 抓 `<title>` 与 favicon | 名称和图标在填完网址后自动取回 |
| 彻底清 Cookie / 网页数据 | `CookieManager` 逐条过期 + `WebStorage.deleteOrigin` | 需要用户点确认 |
| 完全体控制台 | 同源页面可直接 `eval`；跨域页面受限 | 见下 |

### 控制台的边界

网页（iframe）里，浏览器不允许父页面读取跨域子页面的 DOM —— 这是同源策略，不是实现偷懒。
当前实现：

- 同源页面：完整的 `eval`、`console` 捕获、DOM 操作都可用
- 跨域页面：会明确提示「跨域页面」，不会假装执行成功

要做到「任何网页都能注入」，需要把网页层从 iframe 换成原生 `WebView`，用
`WebView.evaluateJavascript` 跨域执行。那是下一步的改造，改动集中在
`native/android/` 加一个 WebView 容器，前端通过插件调用而不走 iframe。

## 设计

- 色系：六套主题全部落在低饱和蓝灰带（`#EEF2F5` / `#E9EEF2` / `#151A1E` …），切换不跳戏
- 图标：全部手绘 SVG（`index.html` 顶部 `<defs>`），无 emoji、无图标字体
- 适配：320px 起成立，360px 有专门断点，横屏矮屏收起 hero
- 留白：8px 基准 + 4px 细档，卡片只用 1px 线 + 极浅阴影，不堆叠装饰
