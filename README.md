# 同揭

一个部署在 GitHub Pages 上的双人数字同时揭晓工具。

## 使用方式

1. 第一位参与者打开网站，复制房间链接发给另一位参与者。
2. 两台设备显示“双方已连接”后，各自自由输入并锁定一个数字。
3. 双方都锁定后，页面会验证承诺并一起揭晓两个数字。
4. 任意一方点击“再来一轮”即可清空本轮并同步开始下一轮。

支持负数、小数与科学记数法，例如 `-3`、`0.25`、`1e6`。

## 隐私与协议

- 应用不使用账号、数据库、Cookie 或本地存储来持久化答案。
- 房间 ID 放在 URL fragment（`#room=...`）中，不会随 GitHub Pages 的 HTTP 请求发送。
- 两个浏览器通过 PeerJS Cloud 交换连接信令，并通过 Google STUN 发现网络路径；这些服务会处理建立连接所需的网络元数据。
- 本应用明确不配置 TURN。连接建立后，答案通过加密的 WebRTC DataChannel 在浏览器间直传；某些严格 NAT 网络可能因此无法连接。
- 每轮先交换 `SHA-256(roundId, value, salt)` 承诺，双方都承诺后才交换答案和随机盐。
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

PeerJS 客户端通过固定版本的 jsDelivr CDN 加载，并使用 Subresource Integrity 校验。PeerServer Cloud 负责会话元数据与连接候选信令；Google STUN 用于 NAT 穿透。应用没有配置 TURN 中继。
