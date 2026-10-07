import { initLessonComms } from "./lesson-comms.mjs?v=20261007-connections1";

const managerView = document.getElementById("managerView");
const roomView = document.getElementById("roomView");
const accountName = document.getElementById("accountName");
const connectionCount = document.getElementById("connectionCount");
const createForm = document.getElementById("connectionCreateForm");
const titleInput = document.getElementById("connectionTitle");
const createStatus = document.getElementById("createStatus");
const list = document.getElementById("connectionsList");
const empty = document.getElementById("connectionsEmpty");
const roomTitle = document.getElementById("roomTitle");
const roomStatus = document.getElementById("roomStatus");

function absoluteUrl(path) {
  return new URL(path, location.origin).toString();
}

function formatLastSeen(value) {
  if (!value) return "Ещё не подключался";
  const date = new Date(value);
  return `Последнее подключение: ${date.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "REQUEST_FAILED");
  return data;
}

async function copyText(value, button) {
  await navigator.clipboard.writeText(value);
  const old = button.textContent;
  button.textContent = "Скопировано";
  setTimeout(() => { button.textContent = old; }, 1400);
}

async function loadMe() {
  const { user } = await fetchJson("/api/auth/me");
  accountName.textContent = user.displayName || user.username || "";
  return user;
}

function renderConnectionCard(connection) {
  const article = document.createElement("article");
  article.className = "connection-card";
  const invite = absoluteUrl(connection.inviteUrl);
  article.innerHTML = `
    <div class="connection-avatar">${(connection.title || "?").trim().slice(0, 1).toUpperCase()}</div>
    <div class="connection-card-copy">
      <strong></strong>
      <span class="connection-last"></span>
      <div class="connection-link-row">
        <input readonly />
        <button class="copy-link" type="button">Копировать</button>
      </div>
    </div>
    <div class="connection-card-actions">
      <a class="open-room">Открыть</a>
      <button class="archive-room" type="button">Архивировать</button>
    </div>
  `;
  article.querySelector("strong").textContent = connection.title;
  article.querySelector(".connection-last").textContent = formatLastSeen(connection.lastParticipantAt);
  article.querySelector("input").value = invite;
  article.querySelector(".open-room").href = `/connection?lesson=${encodeURIComponent(connection.id)}`;
  article.querySelector(".copy-link").addEventListener("click", () => copyText(invite, article.querySelector(".copy-link")));
  article.querySelector(".archive-room").addEventListener("click", async () => {
    const button = article.querySelector(".archive-room");
    button.disabled = true;
    try {
      await fetchJson(`/api/connections/${encodeURIComponent(connection.id)}/archive`, { method: "POST" });
      article.remove();
      const remaining = list.querySelectorAll(".connection-card").length;
      connectionCount.textContent = String(remaining);
      empty.hidden = remaining !== 0;
    } catch {
      button.disabled = false;
    }
  });
  return article;
}

async function loadConnections() {
  const { connections } = await fetchJson("/api/connections");
  list.replaceChildren();
  for (const connection of connections) list.appendChild(renderConnectionCard(connection));
  connectionCount.textContent = String(connections.length);
  empty.hidden = connections.length !== 0;
}

async function initManager() {
  managerView.hidden = false;
  const user = await loadMe();
  if (user.role !== "admin") {
    location.replace("/cabinet");
    return;
  }
  await loadConnections();

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const button = createForm.querySelector("button");
    button.disabled = true;
    createStatus.textContent = "Создаём…";
    try {
      const { connection } = await fetchJson("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      titleInput.value = "";
      createStatus.textContent = "Подключение создано. Постоянная ссылка готова.";
      list.prepend(renderConnectionCard(connection));
      const count = list.querySelectorAll(".connection-card").length;
      connectionCount.textContent = String(count);
      empty.hidden = true;
    } catch {
      createStatus.textContent = "Не удалось создать подключение.";
    } finally {
      button.disabled = false;
    }
  });
}

async function initRoom(lessonId) {
  roomView.hidden = false;
  const user = await loadMe();
  const { connection } = await fetchJson(`/api/connections/${encodeURIComponent(lessonId)}?lesson=${encodeURIComponent(lessonId)}`);
  roomTitle.textContent = connection.title;
  roomStatus.classList.add("connection-presence");
  roomStatus.innerHTML = `
    <span class="presence-row presence-me"><i></i><b>Вы:</b> <span>подключаемся…</span></span>
    <span class="presence-row presence-peer"><i></i><b></b> <span>не в сети</span></span>
  `;
  const myPresence = roomStatus.querySelector(".presence-me");
  const peerPresence = roomStatus.querySelector(".presence-peer");
  const myPresenceText = myPresence.querySelector("span:last-child");
  const peerPresenceLabel = peerPresence.querySelector("b");
  const peerPresenceText = peerPresence.querySelector("span:last-child");
  peerPresenceLabel.textContent = user.role === "admin" ? `${connection.title}:` : "Admin:";

  const realtimeClientId =
    sessionStorage.getItem("school:realtimeClientId") || crypto.randomUUID();
  sessionStorage.setItem("school:realtimeClientId", realtimeClientId);

  const socketRole = user.role === "admin" ? "teacher" : "student";
  const socket = io({ auth: { role: socketRole, lessonId, clientId: realtimeClientId } });

  function setPresenceRow(row, online, text) {
    row.classList.toggle("online", online);
    row.classList.toggle("offline", !online);
    row.querySelector("span:last-child").textContent = text;
  }

  socket.on("connect", () => {
    setPresenceRow(myPresence, true, "онлайн");
  });
  socket.on("disconnect", () => {
    setPresenceRow(myPresence, false, "переподключаемся…");
    setPresenceRow(peerPresence, false, "статус неизвестен");
  });
  socket.on("connection:presence", (presence = {}) => {
    const me = socketRole === "teacher" ? presence.teacher : presence.student;
    const peer = socketRole === "teacher" ? presence.student : presence.teacher;
    setPresenceRow(myPresence, Boolean(me?.online), me?.online ? "онлайн" : "не в сети");
    setPresenceRow(peerPresence, Boolean(peer?.online), peer?.online ? "онлайн" : "не в сети");
    if (user.role !== "admin" && peer?.displayName) {
      peerPresenceLabel.textContent = `${peer.displayName}:`;
    }
  });

  initLessonComms({
    socket,
    role: socketRole,
    lessonId,
    context: "connection",
    showSnackbar: ({ message }) => {
      roomStatus.textContent = message || "Ошибка связи";
    },
  });

  requestAnimationFrame(() => {
    document.querySelector(".lesson-comms-chat-button")?.click();
  });
}

const lessonId = new URLSearchParams(location.search).get("lesson");
if (location.pathname === "/connection" || lessonId) {
  initRoom(lessonId).catch(() => {
    roomStatus.textContent = "Не удалось открыть комнату.";
  });
} else {
  initManager().catch(() => {
    createStatus.textContent = "Не удалось загрузить подключения.";
  });
}
