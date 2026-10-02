const submitButton = document.getElementById("submitHomeworkBtn");
const lessonId = new URLSearchParams(location.search).get("lesson");

async function getCurrentSession() {
  if (!lessonId || !submitButton) return;
  const response = await fetch("/api/lessons", { cache: "no-store" });
  if (!response.ok) return;
  const payload = await response.json();
  const lesson = (payload.lessons || []).find((item) => item.id === lessonId);
  if (!lesson || lesson.type !== "homework") return;
  submitButton.hidden = false;
}

submitButton?.addEventListener("click", async () => {
  submitButton.disabled = true;
  submitButton.textContent = "Сдаём…";
  try {
    const response = await fetch(`/api/homework/submit?lesson=${encodeURIComponent(lessonId)}`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    submitButton.textContent = "✓ Работа сдана";
    submitButton.classList.add("submitted");
  } catch {
    submitButton.disabled = false;
    submitButton.textContent = "Не удалось сдать. Повторить";
  }
});

getCurrentSession().catch(() => {});
