# 见素

见素抱朴。低饱和浅蓝的安静浏览器，中文界面，Capacitor 原生外壳，GitHub Actions 直接产出 APK。

## 目录

```
www/                            网页资源（Capacitor webDir）
  index.html                    单页外壳
  manifest.webmanifest          PWA 声明
  assets/css/tokens.css         配色与刻度变量
  assets/css/app.css            布局与组件
  assets/js/store.js            IndexedDB 持久化 + localStorage 镜像
  assets/js/metadata.js         网址规范化、标题抓取、图标回退
  assets/js/native.js           原生桥（浏览器自动降级）
  assets/js/tabs.js             标签页 / WebView / 缩放 / 注入
  assets/js/ai.js               一句话 → 控制台代码
  assets/js/app.js              主控
native/android/
  MainActivity.java             沉浸式、视口修正、返回键退栈
  JianSuNativePlugin.java       原生桥入口
  TabHost.java                  每标签一个真实 WebView + 三档全屏
  file_paths.xml                FileProvider 路径
native/android/res/             各密度应用图标（由用户提供的 PNG 生成）
native/keystore/                固定签名密钥
scripts/make_keystore.py        构建时生成固定 keystore
.github/workflows/build-apk.yml 打包流水线
```

## 关于全屏的三档

| 模式 | 表现 | 说明 |
|---|---|---|
| ① 有顶栏 | 浏览器顶栏 + 系统状态栏 | 网页层顶部显示地址栏与标签条 |
| ② 有状态栏 | 无顶栏 + 状态栏 | 状态栏保留，底色自动取页面顶部最近的颜色 |
| ③ 完全全屏 | 无顶栏 + 挤掉状态栏 | 内容铺满整屏，滑动边缘可临时唤出状态栏 |

网页默认使用**模式②**。在「网页更多菜单」或「设置 → 站点管理 → 某站点」里可以按站点单独设置，设置后下次打开该网页生效，不触碰任何网页数据。

「添加到桌面」的快捷方式默认使用**模式③**。

## 签名

`debug` 与 `release` 都使用 `native/keystore` 派生的固定 keystore（构建时由 `scripts/make_keystore.py` 生成）。这样每次产出的 APK 签名一致，可以直接覆盖安装。

安装过早期版本的设备需要先卸载一次——那几个包的签名是 CI 随机生成的，无法覆盖。

## 已知限制

- **内核切换**：Android 只允许应用使用系统自带的 WebView。要真正的双内核需要打包 GeckoView，体积增加约 80MB。
- **输入法同步升起（P2）**：`SOFT_INPUT_ADJUST_RESIZE` 已开启，但键盘动画与 WebView 重排无法做到帧级同步，只在键盘稳定后把焦点输入框滚进可视区。
