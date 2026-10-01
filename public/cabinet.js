const dialog = document.getElementById("helpDialog");
const accountName = document.getElementById("accountName");
const teacherCard = document.querySelector(".role-teacher");
const studentCard = document.querySelector(".role-student");
const perfButton = document.getElementById("perfLogButton");
const note = document.getElementById("landingNote");
const lessonSection = document.getElementById("lessonSection");
const lessonList = document.getElementById("lessonList");

document.getElementById("infoBtn").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

function lessonUrl(role, lessonId) {
  return `/${role}?lesson=${encodeURIComponent(lessonId)}`;
}

function renderLessons(user, lessons) {
  lessonList.innerHTML = "";
  lessonSection.hidden = lessons.length === 0;

  if (!lessons.length) {
    note.textContent = "Для этого аккаунта пока нет активных уроков.";
    return;
  }

  const firstLesson = lessons[0];
  if (user.role === "teacher") teacherCard.href = lessonUrl("teacher", firstLesson.id);
  if (user.role === "student") studentCard.href = lessonUrl("student", firstLesson.id);

  for (const lesson of lessons) {
    const item = document.createElement("div");
    item.className = "lesson-card";

    const copy = document.createElement("div");
    copy.className = "lesson-card-copy";
    const title = document.createElement("strong");
    title.textContent = lesson.title || lesson.id;
    const meta = document.createElement("span");
    meta.textContent = `ID: ${lesson.id}`;
    copy.append(title, meta);
    item.append(copy);

    const actions = document.createElement("div");
    actions.className = "lesson-actions";

    if (user.role === "teacher" || user.role === "admin") {
      const teacherLink = document.createElement("a");
      teacherLink.href = lessonUrl("teacher", lesson.id);
      teacherLink.textContent = "Учитель";
      actions.append(teacherLink);
    }
    if (user.role === "student" || user.role === "admin") {
      const studentLink = document.createElement("a");
      studentLink.href = lessonUrl("student", lesson.id);
      studentLink.textContent = "Ученик";
      actions.append(studentLink);
    }

    item.append(actions);
    lessonList.append(item);
  }
}

async function loadAccount() {
  const [accountRes, lessonsRes] = await Promise.all([
    fetch("/api/auth/me", { cache: "no-store" }),
    fetch("/api/lessons", { cache: "no-store" }),
  ]);

  if (accountRes.status === 401 || lessonsRes.status === 401) {
    location.replace("/");
    return;
  }
  if (!accountRes.ok || !lessonsRes.ok) throw new Error("CABINET_LOAD_FAILED");

  const { user } = await accountRes.json();
  const { lessons = [] } = await lessonsRes.json();
  accountName.textContent = `${user.displayName || user.username} · ${user.role}`;

  if (user.role === "teacher") {
    studentCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Выберите урок. Каждый урок теперь имеет отдельные PDF, пометки и realtime.";
  } else if (user.role === "student") {
    teacherCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Выберите урок. Материалы и пометки разделены между уроками.";
  } else {
    note.textContent = "Администратор может открыть любую сторону выбранного урока.";
  }

  renderLessons(user, lessons);
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/");
});

loadAccount().catch(() => location.replace("/"));
