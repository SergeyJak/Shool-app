const form = document.getElementById("joinForm");
const lessonName = document.getElementById("lessonName");
const nameInput = document.getElementById("studentName");
const button = document.getElementById("joinBtn");
const errorEl = document.getElementById("joinError");
const token = location.pathname.split("/").filter(Boolean).pop();

async function loadInvite() {
  const res = await fetch(`/api/join/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) {
    lessonName.textContent = "Ссылка недействительна или занятие уже завершено.";
    return;
  }
  const { lesson } = await res.json();
  lessonName.textContent = lesson.type === "homework"
    ? `Домашняя работа: ${lesson.title}`
    : `Урок: ${lesson.title}`;
  form.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = "Подключаем…";
  try {
    const res = await fetch(`/api/join/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "JOIN_FAILED");
    location.replace(data.redirect);
  } catch (error) {
    errorEl.textContent = error.message === "TOO_MANY_ATTEMPTS"
      ? "Слишком много попыток подключения. Подождите немного и попробуйте снова."
      : "Не удалось подключиться. Проверьте ссылку и попробуйте ещё раз.";
    errorEl.hidden = false;
    button.disabled = false;
    button.textContent = "Войти в занятие";
  }
});

loadInvite().catch(() => {
  lessonName.textContent = "Не удалось проверить ссылку.";
});