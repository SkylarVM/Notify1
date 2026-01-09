import firebaseConfig from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, onSnapshot, serverTimestamp, deleteDoc, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);

// --------------------- DOM ---------------------
const $ = (id) => document.getElementById(id);

const onboarding = $("onboarding");
const app = $("app");

const handleInput = $("handleInput");
const nameInput = $("nameInput");
const saveProfileBtn = $("saveProfileBtn");

const enableAlertsBtn = $("enableAlertsBtn");
const signOutBtn = $("signOutBtn");
const meBadge = $("meBadge");

const newDmBtn = $("newDmBtn");
const newGroupBtn = $("newGroupBtn");
const chatList = $("chatList");

const emptyState = $("emptyState");
const chatView = $("chatView");
const chatTitle = $("chatTitle");
const chatMeta = $("chatMeta");

const inviteBtn = $("inviteBtn");
const callBtn = $("callBtn");

const messagesEl = $("messages");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");

const codesList = $("codesList");
const codeName = $("codeName");
const codeMode = $("codeMode");
const codeColor = $("codeColor");
const codeSound = $("codeSound");
const codeText = $("codeText");
const saveCodeBtn = $("saveCodeBtn");

const incomingOverlay = $("incomingOverlay");
const incomingTitle = $("incomingTitle");
const incomingFrom = $("incomingFrom");
const incomingText = $("incomingText");
const incomingOpenBtn = $("incomingOpenBtn");
const incomingDismissBtn = $("incomingDismissBtn");

const callModal = $("callModal");
const callRoomTitle = $("callRoomTitle");
const callRoomSub = $("callRoomSub");
const leaveCallBtn = $("leaveCallBtn");
const videoGrid = $("videoGrid");
const micBtn = $("micBtn");
const camBtn = $("camBtn");
const shareBtn = $("shareBtn");

// --------------------- App State ---------------------
let uid = null;
let me = null; // { uid, handle, name }
let activeConv = null; // { id, type, name, memberUids, membersMap }
let unsubMessages = null;
let unsubCodes = null;
let unsubConvs = null;
let unsubIncoming = null;

// Meet/WebRTC state
let inCall = false;
let localStream = null;
let screenStream = null;
let peers = new Map(); // remoteUid -> RTCPeerConnection
let unsubParticipants = null;
let unsubSignals = null;

const RTC_CFG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// --------------------- Alerts (sound + notifications) ---------------------
let audioEnabled = false;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

async function enableAlerts() {
  try {
    ensureAudio();
    await audioCtx.resume();
    audioEnabled = true;
    enableAlertsBtn.textContent = "Alerts enabled ✅";
    playTone("ping");

    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    alert("Could not enable alerts. Try again.");
  }
}

function playTone(soundKey) {
  if (!audioEnabled) return;
  ensureAudio();

  const patterns = {
    sos: [880, 880, 880, 660, 660, 660, 880, 880, 880],
    ping: [880, 1320, 880],
    soft: [440, 550, 440],
  };
  const seq = patterns[soundKey] || patterns.sos;

  let t = audioCtx.currentTime;
  for (const f of seq) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

    o.start(t);
    o.stop(t + 0.22);
    t += 0.24;
  }
}

function notifyDesktop(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body });
}

// --------------------- Helpers ---------------------
function cleanHandle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

function nowTime(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function convDisplayName(conv) {
  if (conv.type === "group") return conv.name || "Group";
  // dm: show the other person's handle/name if possible (best-effort)
  return conv.name || "DM";
}

async function safeCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert("Copied invite link ✅");
  } catch {
    prompt("Copy this link:", text);
  }
}

// --------------------- Auth bootstrap ---------------------
enableAlertsBtn.onclick = enableAlerts;

signOutBtn.onclick = async () => {
  // “Reset profile” = clear local user doc reference by reloading with a new anon session.
  // (Anonymous auth doesn’t really “sign out” cleanly for all use-cases in a demo.)
  location.reload();
};

await signInAnonymously(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  uid = user.uid;

  const userDoc = await getDoc(doc(db, "users", uid));
  if (userDoc.exists()) {
    me = { uid, ...userDoc.data() };
    showApp();
    await maybeAcceptInviteFromUrl();
    subscribeConversations();
  } else {
    showOnboarding();
    await maybeAcceptInviteFromUrl(true); // will defer join until profile saved
  }
});

// --------------------- Onboarding/Profile ---------------------
function showOnboarding() {
  onboarding.classList.remove("hidden");
  app.classList.add("hidden");
  meBadge.classList.add("hidden");
  signOutBtn.classList.add("hidden");
}

function showApp() {
  onboarding.classList.add("hidden");
  app.classList.remove("hidden");
  meBadge.classList.remove("hidden");
  signOutBtn.classList.remove("hidden");
  meBadge.textContent = `@${me.handle} · ${me.name}`;
}

saveProfileBtn.onclick = async () => {
  const handle = cleanHandle(handleInput.value);
  const name = String(nameInput.value || "").trim().slice(0, 40);

  if (handle.length < 3) return alert("Handle must be at least 3 characters (letters/numbers/_).");
  if (name.length < 1) return alert("Please enter a display name.");

  // Claim handle if free
  const handleRef = doc(db, "handles", handle);
  const existing = await getDoc(handleRef);

  if (existing.exists() && existing.data().uid !== uid) {
    return alert("That handle is taken. Choose another.");
  }

  await setDoc(handleRef, { uid }, { merge: true });
  await setDoc(doc(db, "users", uid), { handle, name, updatedAt: serverTimestamp() }, { merge: true });

  me = { uid, handle, name };
  showApp();
  await maybeAcceptInviteFromUrl();
  subscribeConversations();
};

// --------------------- Invites ---------------------
function getInviteTokenFromUrl() {
  const u = new URL(location.href);
  const token = u.searchParams.get("invite");
  return token ? String(token).trim() : null;
}

async function maybeAcceptInviteFromUrl(deferUntilProfile = false) {
  const token = getInviteTokenFromUrl();
  if (!token) return;

  // remove invite from URL (keeps app clean)
  const u = new URL(location.href);
  u.searchParams.delete("invite");
  history.replaceState({}, "", u.toString());

  // if profile not saved yet, store token in session and return
  if (deferUntilProfile && (!me || !me.handle)) {
    sessionStorage.setItem("pendingInvite", token);
    return;
  }

  const pending = sessionStorage.getItem("pendingInvite");
  if (pending) {
    sessionStorage.removeItem("pendingInvite");
    await acceptInvite(pending);
  } else {
    await acceptInvite(token);
  }
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function acceptInvite(token) {
  const invRef = doc(db, "invites", token);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) return alert("Invite link is invalid or expired.");

  const { convId } = invSnap.data();
  if (!convId) return alert("Invite link is invalid.");

  // Add member to conversation
  const convRef = doc(db, "conversations", convId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) return alert("This chat no longer exists.");

  const conv = convSnap.data();
  const memberUids = Array.from(new Set([...(conv.memberUids || []), uid]));
  const membersMap = { ...(conv.membersMap || {}), [uid]: true };

  await updateDoc(convRef, { memberUids, membersMap });

  // Select after list loads (or instantly if already loaded)
  setTimeout(() => selectConversation(convId), 500);
}

inviteBtn.onclick = async () => {
  if (!activeConv) return;

  const token = randomToken();
  await setDoc(doc(db, "invites", token), {
    convId: activeConv.id,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  const link = `${location.origin}${location.pathname}?invite=${token}`;
  await safeCopy(link);
};

// --------------------- Conversations (DMs + Groups) ---------------------
function subscribeConversations() {
  if (unsubConvs) unsubConvs();

  const qConvs = query(collection(db, "conversations"), where("memberUids", "array-contains", uid), orderBy("updatedAt", "desc"));
  unsubConvs = onSnapshot(qConvs, async (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderConversationList(items);
    // if active conv was deleted
    if (activeConv && !items.some(c => c.id === activeConv.id)) {
      activeConv = null;
      showEmptyState();
    }
  });
}

function renderConversationList(convs) {
  chatList.innerHTML = "";

  for (const c of convs) {
    const div = document.createElement("div");
    div.className = "chatItem" + (activeConv?.id === c.id ? " active" : "");

    const top = document.createElement("div");
    top.className = "chatItemTop";

    const name = document.createElement("div");
    name.className = "chatName";
    name.textContent = convDisplayName(c);

    const type = document.createElement("div");
    type.className = "chatType";
    type.textContent = c.type?.toUpperCase() || "CHAT";

    top.appendChild(name);
    top.appendChild(type);

    const preview = document.createElement("div");
    preview.className = "chatPreview";
    preview.textContent = c.lastPreview || "";

    div.appendChild(top);
    div.appendChild(preview);

    div.onclick = () => selectConversation(c.id);
    chatList.appendChild(div);
  }
}

async function selectConversation(convId) {
  const convRef = doc(db, "conversations", convId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) return;

  activeConv = { id: convSnap.id, ...convSnap.data() };

  emptyState.classList.add("hidden");
  chatView.classList.remove("hidden");

  chatTitle.textContent = convDisplayName(activeConv);
  chatMeta.textContent = activeConv.type === "group"
    ? `${(activeConv.memberUids || []).length} members`
    : `Direct message`;

  // highlight selection
  [...document.querySelectorAll(".chatItem")].forEach(x => x.classList.remove("active"));
  // (re-render list will also handle this; but keep it snappy)

  subscribeMessages();
  subscribeCodes();
  subscribeIncomingCodeEvents();
}

function showEmptyState() {
  emptyState.classList.remove("hidden");
  chatView.classList.add("hidden");
  if (unsubMessages) unsubMessages();
  if (unsubCodes) unsubCodes();
  if (unsubIncoming) unsubIncoming();
}

newGroupBtn.onclick = async () => {
  const name = prompt("Group name:", "My group");
  if (!name) return;

  const convRef = await addDoc(collection(db, "conversations"), {
    type: "group",
    name: String(name).trim().slice(0, 50),
    memberUids: [uid],
    membersMap: { [uid]: true },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastPreview: "",
  });

  // default codes
  await createDefaultCodes(convRef.id);

  await selectConversation(convRef.id);
};

newDmBtn.onclick = async () => {
  const handle = cleanHandle(prompt("Enter the other user handle (e.g. skylarm):", ""));
  if (!handle) return;

  const handleSnap = await getDoc(doc(db, "handles", handle));
  if (!handleSnap.exists()) return alert("User not found.");

  const otherUid = handleSnap.data().uid;
  if (!otherUid || otherUid === uid) return;

  // try find existing dm
  const qDm = query(
    collection(db, "conversations"),
    where("type", "==", "dm"),
    where("memberUids", "array-contains", uid),
    limit(25)
  );
  const dmSnap = await getDocs(qDm);
  const existing = dmSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(c => (c.memberUids || []).includes(otherUid) && (c.memberUids || []).length === 2);

  if (existing) return selectConversation(existing.id);

  const convRef = await addDoc(collection(db, "conversations"), {
    type: "dm",
    name: `DM`,
    memberUids: [uid, otherUid],
    membersMap: { [uid]: true, [otherUid]: true },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastPreview: "",
  });

  await createDefaultCodes(convRef.id);
  await selectConversation(convRef.id);
};

async function createDefaultCodes(convId) {
  const base = collection(db, "conversations", convId, "codes");
  const defaults = [
    { name: "SOS", mode: "CALL", colorHex: "#ff2d2d", sound: "sos", text: "I need help now." },
    { name: "PICK ME UP", mode: "MESSAGE", colorHex: "#ffb020", sound: "ping", text: "Can you call me with an excuse?" },
    { name: "CHECK IN", mode: "NOTIFICATION", colorHex: "#2dd4ff", sound: "soft", text: "Check in with me when you can." }
  ];
  for (const c of defaults) {
    await addDoc(base, { ...c, createdAt: serverTimestamp(), createdBy: uid });
  }
}

// --------------------- Messages ---------------------
function subscribeMessages() {
  if (!activeConv) return;
  if (unsubMessages) unsubMessages();

  messagesEl.innerHTML = "";

  const qMsg = query(
    collection(db, "conversations", activeConv.id, "messages"),
    orderBy("createdAt", "asc")
  );

  unsubMessages = onSnapshot(qMsg, async (snap) => {
    messagesEl.innerHTML = "";
    for (const d of snap.docs) {
      const m = d.data();
      messagesEl.appendChild(renderMessage(m));
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function renderMessage(m) {
  const isMe = m.senderUid === uid;

  const b = document.createElement("div");
  b.className = "bubble" + (isMe ? " me" : "") + (m.kind === "code" ? " codeBubble" : "");
  if (m.kind === "code" && m.colorHex) b.style.borderLeftColor = m.colorHex;

  const top = document.createElement("div");
  top.className = "bubbleTop";

  const n = document.createElement("div");
  n.className = "bubbleName";
  n.textContent = m.senderName || "Unknown";

  const t = document.createElement("div");
  t.className = "bubbleTime";
  t.textContent = nowTime(m.createdAt);

  top.appendChild(n);
  top.appendChild(t);

  const txt = document.createElement("div");
  txt.className = "bubbleText";
  txt.textContent = m.text || "";

  b.appendChild(top);
  b.appendChild(txt);
  return b;
}

async function sendText(text) {
  if (!activeConv) return;
  const clean = String(text || "").trim();
  if (!clean) return;

  await addDoc(collection(db, "conversations", activeConv.id, "messages"), {
    kind: "text",
    text: clean,
    senderUid: uid,
    senderName: me.name,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "conversations", activeConv.id), {
    updatedAt: serverTimestamp(),
    lastPreview: clean.slice(0, 120),
  });
}

sendBtn.onclick = async () => {
  await sendText(messageInput.value);
  messageInput.value = "";
};

messageInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await sendText(messageInput.value);
    messageInput.value = "";
  }
});

// --------------------- Codes ---------------------
function subscribeCodes() {
  if (!activeConv) return;
  if (unsubCodes) unsubCodes();

  const qCodes = query(collection(db, "conversations", activeConv.id, "codes"), orderBy("createdAt", "asc"));
  unsubCodes = onSnapshot(qCodes, (snap) => {
    const codes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCodes(codes);
  });
}

function renderCodes(codes) {
  codesList.innerHTML = "";

  for (const c of codes) {
    const row = document.createElement("div");
    row.className = "codeRow";

    const left = document.createElement("div");
    left.className = "codeLeft";

    const name = document.createElement("div");
    name.className = "codeName";
    name.textContent = c.name;

    const meta = document.createElement("div");
    meta.className = "codeMeta";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = c.colorHex || "#2dd4ff";

    const info = document.createElement("span");
    info.textContent = `${c.mode} • ${c.sound}`;

    meta.appendChild(dot);
    meta.appendChild(info);

    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "pill danger";
    btn.textContent = "Trigger";
    btn.onclick = () => triggerCode(c);

    row.appendChild(left);
    row.appendChild(btn);
    codesList.appendChild(row);
  }
}

saveCodeBtn.onclick = async () => {
  if (!activeConv) return;

  const n = String(codeName.value || "").trim().slice(0, 40);
  if (!n) return alert("Code name is required.");

  await addDoc(collection(db, "conversations", activeConv.id, "codes"), {
    name: n,
    mode: codeMode.value,
    colorHex: codeColor.value,
    sound: codeSound.value,
    text: String(codeText.value || "").trim().slice(0, 200),
    createdAt: serverTimestamp(),
    createdBy: uid
  });

  codeName.value = "";
  codeText.value = "";
};

async function triggerCode(code) {
  if (!activeConv) return;

  const override = prompt("Optional override text (blank uses default):", "") || "";
  const text = override.trim() || code.text || `${code.name}`;

  // Write a CODE message
  await addDoc(collection(db, "conversations", activeConv.id, "messages"), {
    kind: "code",
    codeName: code.name,
    mode: code.mode,
    colorHex: code.colorHex,
    sound: code.sound,
    text,
    senderUid: uid,
    senderName: me.name,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "conversations", activeConv.id), {
    updatedAt: serverTimestamp(),
    lastPreview: `🔔 ${code.name}: ${text}`.slice(0, 120),
  });
}

// Listen for code events and show overlay/alerts
function subscribeIncomingCodeEvents() {
  if (unsubIncoming) unsubIncoming();
  if (!activeConv) return;

  // listen to last messages and react to CODEs not from me
  const qLast = query(
    collection(db, "conversations", activeConv.id, "messages"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  unsubIncoming = onSnapshot(qLast, (snap) => {
    for (const d of snap.docChanges()) {
      if (d.type !== "added") continue;
      const m = d.doc.data();
      if (m.kind !== "code") continue;
      if (m.senderUid === uid) continue;

      // ring + desktop notification + overlay
      playTone(m.sound || "sos");
      notifyDesktop(`Notify code: ${m.codeName}`, `${m.senderName}: ${m.text || ""}`);

      showIncomingOverlay(m);
    }
  });
}

function showIncomingOverlay(m) {
  incomingOverlay.classList.remove("hidden");
  const card = incomingOverlay.querySelector(".overlayCard");
  card.style.boxShadow = `0 18px 60px rgba(0,0,0,.55), 0 0 0 2px ${m.colorHex || "#2dd4ff"}66`;
  card.style.borderColor = `${m.colorHex || "#2dd4ff"}55`;

  incomingTitle.textContent = m.codeName || "CODE";
  incomingFrom.textContent = `From: ${m.senderName}`;
  incomingText.textContent = m.text || "";

  incomingOpenBtn.onclick = async () => {
    incomingOverlay.classList.add("hidden");
    if (m.mode === "CALL") {
      await openCall();
    }
  };

  incomingDismissBtn.onclick = () => {
    incomingOverlay.classList.add("hidden");
  };
}

// --------------------- Meet-like Call (WebRTC via Firestore signaling) ---------------------
callBtn.onclick = openCall;
leaveCallBtn.onclick = leaveCall;

micBtn.onclick = toggleMic;
camBtn.onclick = toggleCam;
shareBtn.onclick = toggleShare;

function addTile(label, stream, isMe) {
  let tile = document.querySelector(`[data-tile="${label}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.tile = label;

    const v = document.createElement("video");
    v.autoplay = true;
    v.playsInline = true;
    if (isMe) v.muted = true;

    const l = document.createElement("div");
    l.className = "label";
    l.textContent = isMe ? `${label} (You)` : label;

    tile.appendChild(v);
    tile.appendChild(l);
    videoGrid.appendChild(tile);
  }

  tile.querySelector("video").srcObject = stream;
}

function removeTile(label) {
  const t = document.querySelector(`[data-tile="${label}"]`);
  if (t) t.remove();
}

async function ensureLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  addTile(me.name, localStream, true);
  return localStream;
}

async function openCall() {
  if (!activeConv) return alert("Select a chat first.");
  if (inCall) return;

  await ensureLocalMedia();

  inCall = true;
  callModal.classList.remove("hidden");
  callRoomTitle.textContent = `Meet Call · ${convDisplayName(activeConv)}`;
  callRoomSub.textContent = `Room: ${activeConv.id}`;

  // join participant list
  await setDoc(doc(db, "calls", activeConv.id, "participants", uid), {
    name: me.name,
    handle: me.handle,
    joinedAt: serverTimestamp()
  }, { merge: true });

  subscribeParticipants();
  subscribeSignals();
}

function subscribeParticipants() {
  if (unsubParticipants) unsubParticipants();

  const qP = query(collection(db, "calls", activeConv.id, "participants"), orderBy("joinedAt", "asc"));
  unsubParticipants = onSnapshot(qP, async (snap) => {
    const participants = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

    for (const p of participants) {
      if (p.uid === uid) continue;
      // Create peer connection if needed
      if (!peers.has(p.uid)) {
        await createPeer(p.uid);
      }
      // Offer rule to avoid “glare”: only the “higher uid” initiates
      if (uid > p.uid) {
        await makeOffer(p.uid);
      }
    }

    // Remove peers who left
    const still = new Set(participants.map(p => p.uid));
    for (const remoteUid of peers.keys()) {
      if (!still.has(remoteUid)) {
        closePeer(remoteUid);
      }
    }
  });
}

function subscribeSignals() {
  if (unsubSignals) unsubSignals();

  const qS = query(
    collection(db, "calls", activeConv.id, "signals"),
    where("to", "==", uid),
    orderBy("createdAt", "asc")
  );

  unsubSignals = onSnapshot(qS, async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== "added") continue;

      const sigId = change.doc.id;
      const s = change.doc.data();

      const from = s.from;
      if (!from) {
        await deleteDoc(doc(db, "calls", activeConv.id, "signals", sigId));
        continue;
      }

      if (!peers.has(from)) await createPeer(from);

      if (s.kind === "offer") await onOffer(from, s.sdp);
      if (s.kind === "answer") await onAnswer(from, s.sdp);
      if (s.kind === "ice") await onIce(from, s.candidate);

      // delete signal after processing
      await deleteDoc(doc(db, "calls", activeConv.id, "signals", sigId));
    }
  });
}

async function sendSignal(to, payload) {
  await addDoc(collection(db, "calls", activeConv.id, "signals"), {
    to,
    from: uid,
    createdAt: serverTimestamp(),
    ...payload
  });
}

async function createPeer(remoteUid) {
  const pc = new RTCPeerConnection(RTC_CFG);

  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    await sendSignal(remoteUid, { kind: "ice", candidate: e.candidate.toJSON() });
  };

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    // label: remote uid (or could fetch name)
    addTile(remoteUid.slice(0, 6), stream, false);
  };

  // add local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  peers.set(remoteUid, pc);
}

async function makeOffer(remoteUid) {
  const pc = peers.get(remoteUid);
  if (!pc) return;

  // if already negotiating, skip
  if (pc.signalingState !== "stable") return;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await sendSignal(remoteUid, { kind: "offer", sdp: pc.localDescription.toJSON() });
}

async function onOffer(remoteUid, sdp) {
  const pc = peers.get(remoteUid);
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await sendSignal(remoteUid, { kind: "answer", sdp: pc.localDescription.toJSON() });
}

async function onAnswer(remoteUid, sdp) {
  const pc = peers.get(remoteUid);
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function onIce(remoteUid, candidateJson) {
  const pc = peers.get(remoteUid);
  if (!pc) return;

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidateJson));
  } catch {}
}

function closePeer(remoteUid) {
  const pc = peers.get(remoteUid);
  if (pc) pc.close();
  peers.delete(remoteUid);
  removeTile(remoteUid.slice(0, 6));
}

async function leaveCall() {
  if (!inCall) return;

  inCall = false;
  callModal.classList.add("hidden");

  if (unsubParticipants) unsubParticipants();
  if (unsubSignals) unsubSignals();
  unsubParticipants = null;
  unsubSignals = null;

  for (const remoteUid of peers.keys()) closePeer(remoteUid);
  peers.clear();

  // leave participant list
  if (activeConv) {
    await deleteDoc(doc(db, "calls", activeConv.id, "participants", uid)).catch(() => {});
  }

  // stop screenshare if active
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  // stop local media to release camera/mic
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  videoGrid.innerHTML = "";
}

function toggleMic() {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  micBtn.textContent = t.enabled ? "Mic" : "Mic (muted)";
}

function toggleCam() {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  camBtn.textContent = t.enabled ? "Cam" : "Cam (off)";
}

async function toggleShare() {
  if (!inCall || !localStream) return;

  if (!screenStream) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];

      for (const pc of peers.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack);
      }

      const mixed = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
      addTile(me.name, mixed, true);

      screenTrack.onended = async () => {
        await stopShare();
      };

      shareBtn.textContent = "Share (on)";
    } catch {
      screenStream = null;
    }
  } else {
    await stopShare();
  }
}

async function stopShare() {
  if (!screenStream || !localStream) return;

  const camTrack = localStream.getVideoTracks()[0];
  for (const pc of peers.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(camTrack);
  }

  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;

  addTile(me.name, localStream, true);
  shareBtn.textContent = "Share";
}
