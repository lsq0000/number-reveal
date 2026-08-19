# 同揭

一个部署在 GitHub Pages 上的双人数字同时揭晓工具。

## 使用方式

1. 第一位参与者打开网站，复制房间链接发给另一位参与者。
2. 两台设备显示“双方已连接”后，各自自由输入并锁定一个数字。
3. 双方都锁定后，页面会验证承诺并一起揭晓两个数字。
4. 任意一方点击“再来一轮”即可清空本轮并同步开始下一轮。

支持负数、小数与科学记数法，例如 `-3`、`0.25`、`1e6`。

## 隐私与协议

- 页面不使用账号、数据库、Cookie 或本地存储。
- 房间 ID 放在 URL fragment（`#room=...`）中，不会随 GitHub Pages 的 HTTP 请求发送。
- 两个浏览器通过 PeerJS Cloud 交换连接所需的信令，答案通过 WebRTC DataChannel 传输。
- 每轮先交换 `SHA-256(roundId, value, salt)` 承诺，双方都承诺后才交换答案和随机盐。
- 纯点对点方案不能阻止恶意参与者在承诺后直接退出，但对方不能先看答案再修改自己的已承诺答案。

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

PeerJS 客户端通过固定版本的 jsDelivr CDN 加载，并使用 Subresource Integrity 校验。默认 PeerServer Cloud 负责会话元数据与连接候选信令；连接建立后，应用数据通常在浏览器之间点对点传输。
