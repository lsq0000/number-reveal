"use strict";

(() => {
  const PROTOCOL_VERSION = 1;
  const REVEAL_DELAY_MS = 900;
  const PEER_OPTIONS = {
    debug: 1,
    config: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      sdpSemantics: "unified-plan",
    },
  };

  const elements = {
    connectionHeading: document.querySelector("#connection-heading"),
    connectionStatus: document.querySelector("#connectionStatus"),
    connectionIndicator: document.querySelector("#connectionIndicator"),
    shareArea: document.querySelector("#shareArea"),
    shareLink: document.querySelector("#shareLink"),
    copyButton: document.querySelector("#copyButton"),
    nativeShareButton: document.querySelector("#nativeShareButton"),
    joinArea: document.querySelector("#joinArea"),
    errorBanner: document.querySelector("#errorBanner"),
    errorMessage: document.querySelector("#errorMessage"),
    retryButton: document.querySelector("#retryButton"),
    roundHeading: document.querySelector("#roundHeading"),
    roundBadge: document.querySelector("#roundBadge"),
    localParticipant: document.querySelector("#localParticipant"),
    remoteParticipant: document.querySelector("#remoteParticipant"),
    localStatus: document.querySelector("#localStatus"),
    remoteStatus: document.querySelector("#remoteStatus"),
    numberForm: document.querySelector("#numberForm"),
    numberInput: document.querySelector("#numberInput"),
    inputError: document.querySelector("#inputError"),
    commitButton: document.querySelector("#commitButton"),
    waitingPanel: document.querySelector("#waitingPanel"),
    waitingMessage: document.querySelector("#waitingMessage"),
    resultPanel: document.querySelector("#resultPanel"),
    resultHeading: document.querySelector("#resultHeading"),
    localResult: document.querySelector("#localResult"),
    remoteResult: document.querySelector("#remoteResult"),
    nextRoundButton: document.querySelector("#nextRoundButton"),
    nextRoundStatus: document.querySelector("#nextRoundStatus"),
    toast: document.querySelector("#toast"),
  };

  const invitedHostId = readRoomId();
  const role = invitedHostId ? "guest" : "host";

  let peer = null;
  let connection = null;
  let connectionReady = false;
  let roundNumber = 1;
  let roundId = role === "host" ? createRoundId() : null;
  let localRound = emptyLocalRound();
  let remoteRound = emptyRemoteRound();
  let showScheduled = false;
  let toastTimer = null;
  let reconnectTimer = null;
  let intentionalRestart = false;
  const suppressedCloseConnections = new WeakSet();
  let roundEpoch = 0;
  let revealTimer = null;
  let roundRevealed = false;

  function emptyLocalRound() {
    return {
      value: null,
      salt: null,
      commitment: null,
      submitting: false,
      revealSent: false,
      verifiedRemote: false,
    };
  }

  function emptyRemoteRound() {
    return {
      commitment: null,
      value: null,
      salt: null,
      verified: false,
      verifiedLocal: false,
    };
  }

  function readRoomId() {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return null;
    const params = new URLSearchParams(fragment);
    const value = params.get("room");
    return value ? value.trim() : null;
  }

  function createRoundId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  }

  function makeShareUrl(peerId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `room=${encodeURIComponent(peerId)}`;
    return url.toString();
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  }

  function normalizeNumber(rawValue) {
    const value = String(rawValue).trim().replace(/\u2212/g, "-");
    const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    if (!value) throw new Error("请输入一个数字。");
    if (!numericPattern.test(value)) throw new Error("格式不正确，请输入普通数字或科学记数法。");
    if (!Number.isFinite(Number(value))) throw new Error("这个数字超出可处理范围，请换一个较小的数。");
    return value;
  }

  async function hashCommitment(activeRoundId, value, salt) {
    const payload = JSON.stringify([activeRoundId, value, salt]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function setConnectionState(state, heading, status) {
    elements.connectionIndicator.className = `connection-indicator is-${state}`;
    elements.connectionHeading.textContent = heading;
    elements.connectionStatus.textContent = status;
  }

  function hideError() {
    elements.errorBanner.hidden = true;
    elements.errorMessage.textContent = "";
  }

  function showError(message, allowRetry = true) {
    elements.errorMessage.textContent = message;
    elements.retryButton.hidden = !allowRetry;
    elements.errorBanner.hidden = false;
    setConnectionState("offline", "连接遇到问题", "可以重试；已经锁定的本轮答案不会被上传或保存。");
  }

  function setParticipant(element, statusElement, state, text) {
    element.dataset.state = state;
    statusElement.textContent = text;
  }

  function renderDisconnectedRound() {
    elements.roundBadge.textContent = "等待连接";
    elements.roundBadge.classList.remove("is-ready");
    elements.commitButton.disabled = true;
    setParticipant(elements.localParticipant, elements.localStatus, "waiting", "待填写");
    setParticipant(elements.remoteParticipant, elements.remoteStatus, "offline", "尚未连接");
  }

  function renderReadyRound() {
    elements.roundHeading.textContent = `第 ${roundNumber} 轮 · 写下你的数字`;
    elements.roundBadge.textContent = "双方已连接";
    elements.roundBadge.classList.add("is-ready");
    elements.numberForm.hidden = false;
    elements.waitingPanel.hidden = true;
    elements.resultPanel.hidden = true;
    elements.numberInput.disabled = false;
    elements.numberInput.value = "";
    elements.numberInput.removeAttribute("aria-invalid");
    elements.inputError.hidden = true;
    elements.inputError.textContent = "";
    elements.commitButton.disabled = false;
    elements.nextRoundButton.disabled = false;
    elements.nextRoundStatus.textContent = "";
    setParticipant(elements.localParticipant, elements.localStatus, "waiting", "待填写");
    setParticipant(elements.remoteParticipant, elements.remoteStatus, "waiting", "待填写");
  }

  function resetRound(nextRoundNumber, nextRoundId) {
    invalidateRound();
    roundNumber = nextRoundNumber;
    roundId = nextRoundId;
    localRound = emptyLocalRound();
    remoteRound = emptyRemoteRound();
    renderReadyRound();
    elements.numberInput.focus();
  }

  function invalidateRound() {
    roundEpoch += 1;
    roundRevealed = false;
    showScheduled = false;
    window.clearTimeout(revealTimer);
    revealTimer = null;
  }

  function send(message) {
    if (!connectionReady || !connection || !connection.open) return false;
    connection.send({ version: PROTOCOL_VERSION, ...message });
    return true;
  }

  function isCurrentRound(message) {
    return typeof message.roundId === "string" && message.roundId === roundId;
  }

  function setupConnection(nextConnection) {
    if (connection) {
      nextConnection.on("open", () => {
        nextConnection.send({ version: PROTOCOL_VERSION, type: "busy" });
        window.setTimeout(() => nextConnection.close(), 150);
      });
      return;
    }

    connection = nextConnection;
    let opened = false;
    const pendingTimer = window.setTimeout(() => {
      if (connection !== nextConnection || opened) return;
      suppressedCloseConnections.add(nextConnection);
      connection = null;
      connectionReady = false;
      try {
        nextConnection.close();
      } catch {
        // Clearing the slot is sufficient if the transport never opened.
      }
      elements.commitButton.disabled = true;
      if (role === "host") {
        setConnectionState("connecting", "等待另一位加入", "上次连接超时，原房间链接仍然有效。");
        elements.shareArea.hidden = false;
        renderDisconnectedRound();
      } else {
        showError("连接房主超时，请检查网络后重试。", true);
      }
    }, 12000);

    nextConnection.on("open", () => {
      window.clearTimeout(pendingTimer);
      if (connection !== nextConnection) {
        suppressedCloseConnections.add(nextConnection);
        nextConnection.close();
        return;
      }
      opened = true;
      connectionReady = true;
      hideError();
      setConnectionState("connected", "两个人已经连接", "现在可以各自填写并锁定数字。");
      elements.shareArea.hidden = true;
      elements.joinArea.hidden = role !== "guest";

      if (role === "host") {
        send({ type: "hello", round: roundNumber, roundId });
        renderReadyRound();
        elements.numberInput.focus();
      }
    });

    nextConnection.on("data", (message) => {
      if (connection !== nextConnection) return;
      void handleMessage(message);
    });

    nextConnection.on("close", () => {
      window.clearTimeout(pendingTimer);
      if (connection !== nextConnection) return;
      connectionReady = false;
      connection = null;
      elements.commitButton.disabled = true;
      setParticipant(elements.remoteParticipant, elements.remoteStatus, "offline", "已离开");
      if (suppressedCloseConnections.has(nextConnection)) {
        suppressedCloseConnections.delete(nextConnection);
        return;
      }
      if (role === "host") {
        setConnectionState("connecting", "等待另一位加入", "原房间链接仍然有效，可以请对方重新打开。");
        elements.shareArea.hidden = false;
        if (opened) startFreshHostRound();
        else renderDisconnectedRound();
      } else {
        invalidateRound();
        showError("房主已离开，或点对点连接已经中断。", true);
      }
    });

    nextConnection.on("error", () => {
      window.clearTimeout(pendingTimer);
      if (connection !== nextConnection) return;
      suppressedCloseConnections.add(nextConnection);
      connectionReady = false;
      connection = null;
      try {
        nextConnection.close();
      } catch {
        // The failed transport may already be closed.
      }
      elements.commitButton.disabled = true;
      if (role === "host") {
        setConnectionState("connecting", "等待另一位加入", "上次连接失败，原房间链接仍然有效。");
        elements.shareArea.hidden = false;
        if (opened) startFreshHostRound();
        else renderDisconnectedRound();
      } else {
        invalidateRound();
        showError("点对点连接失败，请检查网络后重试。", true);
      }
    });
  }

  async function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.version !== PROTOCOL_VERSION) {
      showError("双方页面版本不同，请都刷新到最新版。", false);
      return;
    }

    switch (message.type) {
      case "busy":
        showError("这个房间已经有两个人了。请让房主新建房间。", false);
        if (connection) suppressedCloseConnections.add(connection);
        connection?.close();
        break;
      case "hello":
        if (role !== "guest" || typeof message.round !== "number" || typeof message.roundId !== "string") return;
        resetRound(message.round, message.roundId);
        send({ type: "hello-ack", roundId });
        break;
      case "hello-ack":
        break;
      case "commit":
        await receiveCommit(message);
        break;
      case "reveal":
        await receiveReveal(message);
        break;
      case "verified":
        receiveVerified(message);
        break;
      case "show":
        if (role === "guest" && isCurrentRound(message) && localRound.verifiedRemote && remoteRound.verifiedLocal) {
          scheduleReveal();
        }
        break;
      case "next-request":
        if (role === "host" && roundRevealed && isCurrentRound(message)) startNextRound();
        break;
      case "round":
        if (role === "guest" && typeof message.round === "number" && typeof message.roundId === "string") {
          resetRound(message.round, message.roundId);
        }
        break;
      case "protocol-error":
        showError("对方检测到本轮数据不一致，请重新连接后再试。", true);
        break;
      default:
        break;
    }
  }

  async function receiveCommit(message) {
    if (!isCurrentRound(message) || typeof message.commitment !== "string" || !/^[a-f0-9]{64}$/u.test(message.commitment)) return;
    if (remoteRound.commitment && remoteRound.commitment !== message.commitment) {
      failProtocol("对方在同一轮发送了不同的承诺。");
      return;
    }

    remoteRound.commitment = message.commitment;
    setParticipant(elements.remoteParticipant, elements.remoteStatus, "committed", "已锁定");
    if (!localRound.commitment) {
      elements.roundBadge.textContent = "对方已锁定";
    }
    maybeSendReveal();
  }

  async function receiveReveal(message) {
    if (!isCurrentRound(message) || remoteRound.verified) return;
    const activeEpoch = roundEpoch;
    const activeRoundId = roundId;
    const activeRemoteRound = remoteRound;
    if (!remoteRound.commitment || typeof message.value !== "string" || typeof message.salt !== "string") {
      failProtocol("收到的揭晓数据不完整。");
      return;
    }

    let normalized;
    try {
      normalized = normalizeNumber(message.value);
    } catch {
      failProtocol("对方揭晓的内容不是有效数字。");
      return;
    }

    if (normalized !== message.value || !/^[A-Za-z0-9_-]{40,60}$/u.test(message.salt)) {
      failProtocol("对方揭晓的数据格式无效。");
      return;
    }

    const expected = await hashCommitment(activeRoundId, message.value, message.salt);
    if (roundEpoch !== activeEpoch || roundId !== activeRoundId || remoteRound !== activeRemoteRound) return;
    if (expected !== remoteRound.commitment) {
      failProtocol("对方揭晓的数字与先前锁定的承诺不一致。");
      return;
    }

    remoteRound.value = message.value;
    remoteRound.salt = message.salt;
    remoteRound.verified = true;
    localRound.verifiedRemote = true;
    send({ type: "verified", roundId });
    maybeCoordinateReveal();
  }

  function receiveVerified(message) {
    if (!isCurrentRound(message) || !localRound.revealSent) return;
    remoteRound.verifiedLocal = true;
    maybeCoordinateReveal();
  }

  function maybeSendReveal() {
    if (!localRound.commitment || !remoteRound.commitment || localRound.revealSent) return;
    localRound.revealSent = send({
      type: "reveal",
      roundId,
      value: localRound.value,
      salt: localRound.salt,
    });
    if (localRound.revealSent) {
      elements.waitingMessage.textContent = "双方都已锁定，正在核验答案…";
    }
  }

  function maybeCoordinateReveal() {
    if (!localRound.verifiedRemote || !remoteRound.verifiedLocal || showScheduled) return;
    if (role === "host") {
      send({ type: "show", roundId });
      scheduleReveal();
    }
  }

  function scheduleReveal() {
    if (showScheduled || !localRound.value || !remoteRound.value) return;
    const activeEpoch = roundEpoch;
    const activeRoundId = roundId;
    showScheduled = true;
    elements.waitingMessage.textContent = "核验完成，一起揭晓…";
    revealTimer = window.setTimeout(() => {
      revealTimer = null;
      if (roundEpoch === activeEpoch && roundId === activeRoundId && showScheduled) renderResult();
    }, REVEAL_DELAY_MS);
  }

  function renderResult() {
    elements.numberForm.hidden = true;
    elements.waitingPanel.hidden = true;
    elements.resultPanel.hidden = false;
    elements.localResult.textContent = localRound.value;
    elements.remoteResult.textContent = remoteRound.value;
    elements.roundBadge.textContent = "已揭晓";
    setParticipant(elements.localParticipant, elements.localStatus, "done", "已揭晓");
    setParticipant(elements.remoteParticipant, elements.remoteStatus, "done", "已揭晓");
    roundRevealed = true;
    elements.resultHeading.focus();
  }

  function failProtocol(message) {
    send({ type: "protocol-error", roundId });
    elements.commitButton.disabled = true;
    showError(message, true);
  }

  async function commitNumber(event) {
    event.preventDefault();
    if (!connectionReady || localRound.commitment || localRound.submitting) return;

    let value;
    try {
      value = normalizeNumber(elements.numberInput.value);
    } catch (error) {
      elements.numberInput.setAttribute("aria-invalid", "true");
      elements.inputError.textContent = error.message;
      elements.inputError.hidden = false;
      elements.numberInput.focus();
      return;
    }

    localRound.submitting = true;
    const activeEpoch = roundEpoch;
    const activeRoundId = roundId;
    const activeLocalRound = localRound;
    elements.commitButton.disabled = true;
    elements.numberInput.disabled = true;
    elements.inputError.hidden = true;
    const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = await hashCommitment(activeRoundId, value, salt);
    if (roundEpoch !== activeEpoch || roundId !== activeRoundId || localRound !== activeLocalRound) return;

    localRound.value = value;
    localRound.salt = salt;
    localRound.commitment = commitment;
    localRound.submitting = false;

    if (!send({ type: "commit", roundId: activeRoundId, commitment })) {
      localRound = emptyLocalRound();
      elements.numberInput.disabled = false;
      elements.commitButton.disabled = false;
      showError("提交时连接已中断，请重新连接。", true);
      return;
    }

    elements.numberForm.hidden = true;
    elements.waitingPanel.hidden = false;
    elements.roundBadge.textContent = remoteRound.commitment ? "双方已锁定" : "你已锁定";
    setParticipant(elements.localParticipant, elements.localStatus, "committed", "已锁定");
    elements.waitingMessage.textContent = remoteRound.commitment ? "双方都已锁定，正在核验答案…" : "正在等待对方提交…";
    maybeSendReveal();
  }

  function startFreshHostRound() {
    if (role !== "host") return;
    invalidateRound();
    roundNumber += 1;
    roundId = createRoundId();
    localRound = emptyLocalRound();
    remoteRound = emptyRemoteRound();
    elements.numberForm.hidden = false;
    elements.waitingPanel.hidden = true;
    elements.resultPanel.hidden = true;
    renderDisconnectedRound();
  }

  function startNextRound() {
    if (role !== "host" || !connectionReady) return;
    const nextRound = roundNumber + 1;
    const nextId = createRoundId();
    resetRound(nextRound, nextId);
    send({ type: "round", round: nextRound, roundId: nextId });
  }

  function requestNextRound() {
    if (!connectionReady || !roundRevealed) return;
    elements.nextRoundButton.disabled = true;
    if (role === "host") {
      startNextRound();
    } else {
      send({ type: "next-request", roundId });
      elements.nextRoundStatus.textContent = "已请求下一轮，正在等待房主同步…";
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(elements.shareLink.value);
      showToast("链接已复制");
    } catch {
      elements.shareLink.select();
      const copied = document.execCommand("copy");
      showToast(copied ? "链接已复制" : "请手动复制链接");
    }
  }

  async function shareRoom() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: "同揭", text: "和我各填一个数字，等两个人都提交后一起揭晓。", url: elements.shareLink.value });
    } catch (error) {
      if (error.name !== "AbortError") showToast("分享失败，请改用复制链接");
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2200);
  }

  function peerErrorMessage(error) {
    switch (error?.type) {
      case "peer-unavailable":
        return "找不到这个房间。请确认房主仍保持页面打开，并重新获取链接。";
      case "network":
      case "server-error":
      case "socket-error":
      case "socket-closed":
        return "无法连接到信令服务，请检查网络后重试。";
      case "browser-incompatible":
        return "当前浏览器不支持点对点连接，请换用新版 Chrome、Edge、Firefox 或 Safari。";
      default:
        return "房间连接失败，请刷新或重试。";
    }
  }

  function initializePeer() {
    window.clearTimeout(reconnectTimer);
    hideError();
    connectionReady = false;
    renderDisconnectedRound();
    setConnectionState("connecting", role === "host" ? "正在准备房间" : "正在加入房间", "正在连接信令服务…");
    elements.shareArea.hidden = true;
    elements.joinArea.hidden = role !== "guest";

    if (!window.peerjs?.Peer) {
      showError("连接组件没有加载成功，请检查网络或内容拦截设置。", true);
      return;
    }

    const nextPeer = new window.peerjs.Peer(PEER_OPTIONS);
    peer = nextPeer;

    nextPeer.on("open", (id) => {
      if (peer !== nextPeer) return;
      if (role === "host") {
        elements.shareLink.value = makeShareUrl(id);
        elements.shareArea.hidden = false;
        setConnectionState("connecting", "房间已经准备好", "把链接发给对方，然后保持这个页面打开。");
      } else {
        const outgoing = nextPeer.connect(invitedHostId, { serialization: "json", reliable: true });
        setupConnection(outgoing);
        setConnectionState("connecting", "正在加入房间", "已经找到信令服务，正在连接房主…");
      }
    });

    nextPeer.on("connection", (incoming) => {
      if (peer !== nextPeer) {
        incoming.close();
        return;
      }
      if (role === "host") setupConnection(incoming);
      else incoming.close();
    });

    nextPeer.on("disconnected", () => {
      if (peer !== nextPeer) return;
      if (connectionReady) {
        elements.connectionStatus.textContent = "点对点连接仍在继续；正在恢复房间服务…";
      }
      if (!nextPeer.destroyed) {
        reconnectTimer = window.setTimeout(() => {
          try {
            nextPeer.reconnect();
          } catch {
            // A later peer error will present the retry action.
          }
        }, 1200);
      }
    });

    nextPeer.on("error", (error) => {
      if (peer !== nextPeer) return;
      if (!connectionReady && connection) {
        const pendingConnection = connection;
        suppressedCloseConnections.add(pendingConnection);
        connection = null;
        try {
          pendingConnection.close();
        } catch {
          // The pending transport may already be closed.
        }
      }
      if (!intentionalRestart) showError(peerErrorMessage(error), true);
    });

    nextPeer.on("close", () => {
      if (peer !== nextPeer) return;
      connectionReady = false;
    });
  }

  function restart() {
    intentionalRestart = true;
    if (connection) suppressedCloseConnections.add(connection);
    window.clearTimeout(reconnectTimer);
    try {
      connection?.close();
      peer?.destroy();
    } catch {
      // The new session below is independent of the old one.
    }
    connection = null;
    peer = null;
    invalidateRound();
    localRound = emptyLocalRound();
    remoteRound = emptyRemoteRound();
    intentionalRestart = false;
    if (role === "host") {
      roundNumber += 1;
      roundId = createRoundId();
    }
    initializePeer();
  }

  elements.numberForm.addEventListener("submit", (event) => {
    void commitNumber(event);
  });
  elements.numberInput.addEventListener("input", () => {
    elements.numberInput.removeAttribute("aria-invalid");
    elements.inputError.hidden = true;
  });
  elements.copyButton.addEventListener("click", () => {
    void copyShareLink();
  });
  elements.nativeShareButton.addEventListener("click", () => {
    void shareRoom();
  });
  elements.retryButton.addEventListener("click", restart);
  elements.nextRoundButton.addEventListener("click", requestNextRound);

  if (navigator.share) elements.nativeShareButton.hidden = false;

  window.addEventListener("beforeunload", () => {
    try {
      peer?.destroy();
    } catch {
      // The browser will release the transport while unloading.
    }
  });

  initializePeer();
})();
