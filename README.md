# 见素

见素抱朴。低饱和浅蓝的安静浏览器，中文界面，Capacitor 原生外壳，GitHub Actions 直接产出 APK。

## 目录

```
www/                            网页资源（Capacitor webDir）
  index.html                    单页外壳
  manifest.webmanifest          PWA 声明
  assets/css/tokens.css         七套低饱和配色 + 间距/圆角/字号刻度
  assets/css/app.css            全部布局与组件
  assets/js/store.js            IndexedDB 持久化 + localStorage 镜像 + 配额
  assets/js/metadata.js         网址规范化、标题抓取、图标回退
  assets/js/native.js           原生桥（浏览器自动降级）
  assets/js/tabs.js             标签页 / WebView / 缩放 / 注入
  assets/js/ai.js               一句话 → 控制台代码
  assets/js/app.js              主控
native/android/
  MainActivity.java             沉浸式 + 视口修正 + IME
  JianSuNativePlugin.java       原生桥入口
  TabHost.java                  每个标签一个真实 WebView
  file_paths.xml                应用内更新的 FileProvider 路径
.github/workflows/build-apk.yml 打包流水线
```

## 打包

推到 `main` 触发 Actions，产物在运行页的 **Artifacts → jiansu-debug-apk**。

## 需求对照

| # | 需求 | 状态 | 实现 |
|---|---|---|---|
| 1 | 改名「见素」 | 完成 | 标题、manifest、`strings.xml`、桌面名称 |
| 2 | 全中文 | 完成 | 无残留外文界面文案 |
| 3 | 自定义图标 | 完成 | manifest 与桌面快捷方式引用给定 PNG |
| 4 | iframe → 原生 WebView | 完成 | `TabHost`，`evaluateJavascript` 跨域执行 |
| 5 | 跨域时明确提示 | 完成 | 浏览器预览模式下返回「跨域页面」并说明原因 |
| 6 | 网页内可开控制台 | 完成 | 网页更多菜单 → 打开控制台 |
| 7 | 切换内核 / 搜索引擎 | 部分 | 搜索引擎可切（必应/百度/谷歌）；内核为系统 WebView，无法在同一 APK 内切换 Trident/Blink 之外的引擎 |
| 8 | 前进后退 + 返回键 | 完成 | 网页内历史 + 系统返回逐级退栈 |
| 9 | 缩放归入更多菜单 | 完成 | 逐页保存缩放，设置页可单独清除 |
| 10 | 真实 PWA / 桌面图标 | 完成 | `ShortcutManager`，名称自动获取可改，图标 432px 矢量绘制 |
| 11 | 系统级权限弹窗 | 完成 | 通知、剪贴板均走系统对话框 |
| 12 | 多级弹窗 | 完成 | 二级 `sheet` + 三级 `confirm`，全部有设计 |
| 13 | 每站点强制持久化 | 完成 | `storage.persist()` + 批准后弹窗告知 + 单站清除 |
| 14 | 后台保活 | 完成 | 逐页开关 + 统一入口 + 设置页汇总 |
| 15 | 配色自定义 / 预设 | 完成 | 色相/明度/灰度三轴调整，可存可删 |
| 16 | 日夜三档 | 完成 | 日间 / 夜间 / 自动（跟随系统） |
| 17 | 移除蓝色点击块 | 完成 | `-webkit-tap-highlight-color: transparent` |
| 18 | 分类可增删 | 完成 | 分类管理弹窗 |
| 19 | 收藏 / 最近可删 | 完成 | 编辑模式逐个删 + 最近一键清空 |
| 20 | 应用内更新 | 完成 | GitHub Releases 检查 + 下载安装（含完整性校验） |
| 21 | 删除数据闪退 | 完成 | 先销毁该站点 WebView，再逐项 try/catch 清理 |
| — | 多标签并行 | 完成 | 网页层顶部标签条 |

## 已知限制

**内核切换（第 7 条）**：Android 只允许应用使用系统自带的 WebView 内核，第三方无法在同一个 APK 里内置第二个渲染引擎。当前只能切换搜索引擎。若要真正的双内核，需要打包 GeckoView 之类的独立引擎，体积会增加约 80MB。
