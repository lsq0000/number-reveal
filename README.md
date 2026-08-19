# 同揭

一个部署在 GitHub Pages 上的双人数字同时揭晓工具：房主可自定义问题，双方锁定数字答案后一起揭晓。

## 使用方式

1. 房主打开网站，输入 1–120 个字符的自定义问题并创建房间。
2. 房主复制短房间链接发给另一位参与者。
3. 两台设备显示“双方已连接”且问题同步后，各自自由输入并锁定一个数字。
4. 双方都锁定后，页面会验证承诺并一起揭晓两个数字。
5. 任意一方点击“再来一轮”即可清空本轮并同步开始下一轮；本房间沿用同一个问题。

支持负数、小数与科学记数法，例如 `-3`、`0.25`、`1e6`。

## 隐私与协议

- 应用不使用账号、数据库、Cookie 或本地存储来持久化答案。
- 分享链接使用 12 位随机房间码，例如 `https://lsq0000.github.io/r/#7KMQ4WPA3RDX`；房间码放在 URL fragment 中，不会随 GitHub Pages 的 HTTP 请求发送。
- 两个浏览器通过 PeerJS Cloud 交换连接信令，并使用 PeerJS 1.5.5 的默认 ICE 配置发现网络路径；这些服务会处理建立连接所需的网络元数据。
- 浏览器会优先尝试 WebRTC 直连；严格 NAT 或限制 UDP 的网络无法直连时，会尝试 PeerJS 默认 TURN 中继。答案始终通过加密的 WebRTC DataChannel 传输。
- 访客连接失败后会分级自动重试；页面回到前台或网络恢复时，也会自动恢复房间服务。单次点对点连接最多等待 30 秒。
- 每轮先交换 `SHA-256(roundId, question, value, salt)` 承诺，双方都承诺后才交换答案和随机盐。
- 这是一种面向自愿参与者的 commit–reveal 流程：它能防止对方看到答案后修改已经承诺的数字，但不能提供有可信裁判的完全公平性。修改过的客户端仍可在收到诚实方揭晓后拒绝发送自己的答案，任何一方也都能中途退出。

## 本地运行

```powershell
python -m http.server 4173 --directory .
```

然后打开 `http://localhost:4173/`。不要直接用 `file://` 打开，因为 Web Crypto 和 WebRTC 需要安全上下文。

## 技术栈

- 原生 HTML / CSS / JavaScript
- Web Crypto API（SHA-256 与随机盐）
- PeerJS 1.5.5 / WebRTC DataChannel
- GitHub Pages

## 第三方服务

PeerJS 客户端通过固定版本的 jsDelivr CDN 加载，并使用 Subresource Integrity 校验。PeerServer Cloud 负责会话元数据与连接候选信令；PeerJS 的默认 ICE 配置提供 STUN，并在直连失败时提供公共 TURN 中继。公共服务不提供本应用控制的可用性保证。
