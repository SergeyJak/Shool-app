const dialog = document.getElementById("helpDialog");
const accountName = document.getElementById("accountName");
const teacherCard = document.querySelector(".role-teacher");
const studentCard = document.querySelector(".role-student");
const perfButton = document.getElementById("perfLogButton");
const note = document.getElementById("landingNote");
const lessonSection = document.getElementById("lessonSection");
const lessonList = document.getElementById("lessonList");
const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const adminUserList = document.getElementById("adminUserList");
const adminLessonList = document.getElementById("adminLessonList");
const createUserForm = document.getElementById("createUserForm");
const createLessonForm = document.getElementById("createLessonForm");
const newLessonTeachers = document.getElementById("newLessonTeachers");
const newLessonStudents = document.getElementById("newLessonStudents");
const adminNavButtons = [...document.querySelectorAll("[data-admin-view]")];
const adminSections = [...document.querySelectorAll("[data-admin-section]")];
const adminUsersCount = document.getElementById("adminUsersCount");
const adminLessonsCount = document.getElementById("adminLessonsCount");

let currentUser = null;
let managedUsers = [];
let managedLessons = [];

document.getElementById("infoBtn").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

function lessonUrl(role, lessonId) {
  return `/${role}?lesson=${encodeURIComponent(lessonId)}`;
}

function selectedValues(container) {
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function showAdminView(view) {
  for (const button of adminNavButtons) {
    button.classList.toggle("active", button.dataset.adminView === view);
  }
  for (const section of adminSections) {
    section.hidden = section.dataset.adminSection !== view;
  }
}

for (const button of adminNavButtons) {
  button.addEventListener("click", () => showAdminView(button.dataset.adminView));
}

function setAdminStatus(message, type = "") {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.dataset.type = type;
  if (message) setTimeout(() => {
    if (adminStatus.textContent === message) adminStatus.textContent = "";
  }, 4500);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Empty/error responses may not have JSON.
  }
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
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

function fillMemberPicker(container, role, selected = []) {
  container.innerHTML = "";
  const selectedSet = new Set(selected);
  const candidates = managedUsers.filter((item) => item.role === role && item.active);

  if (!candidates.length) {
    const empty = document.createElement("span");
    empty.className = "member-picker-empty";
    empty.textContent = role === "teacher" ? "Нет активных учителей" : "Нет активных учеников";
    container.append(empty);
    return;
  }

  for (const user of candidates) {
    const label = document.createElement("label");
    label.className = "member-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = user.id;
    checkbox.checked = selectedSet.has(user.id);

    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = user.displayName || user.username;
    const username = document.createElement("small");
    username.textContent = user.username;
    copy.append(name, username);

    label.append(checkbox, copy);
    container.append(label);
  }
}

function renderAdminMemberChoices() {
  fillMemberPicker(newLessonTeachers, "teacher");
  fillMemberPicker(newLessonStudents, "student");
}

function renderAdminUsers() {
  adminUserList.innerHTML = "";
  for (const user of managedUsers) {
    const row = document.createElement("div");
    row.className = `admin-row ${user.active ? "" : "is-inactive"}`;

    const identity = document.createElement("div");
    identity.className = "admin-row-main";
    const name = document.createElement("input");
    name.value = user.displayName || "";
    name.maxLength = 80;
    name.setAttribute("aria-label", `Имя ${user.username}`);
    const meta = document.createElement("span");
    meta.textContent = `${user.username} · ${user.role === "teacher" ? "учитель" : "ученик"}`;
    identity.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Сохранить";
    save.addEventListener("click", async () => {
      try {
        await apiJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ displayName: name.value }),
        });
        setAdminStatus("Пользователь обновлён", "success");
        await loadAdminData();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary";
    toggle.textContent = user.active ? "Деактивировать" : "Активировать";
    toggle.addEventListener("click", async () => {
      try {
        await apiJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !user.active }),
        });
        setAdminStatus(user.active ? "Пользователь деактивирован" : "Пользователь активирован", "success");
        await loadAdminData();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });

    actions.append(save, toggle);
    row.append(identity, actions);
    adminUserList.append(row);
  }
}

function memberPicker(role, selected) {
  const container = document.createElement("div");
  container.className = "member-picker";
  fillMemberPicker(container, role, selected);
  return container;
}

function renderAdminLessons() {
  adminLessonList.innerHTML = "";
  for (const lesson of managedLessons) {
    const row = document.createElement("div");
    row.className = `admin-lesson-row ${lesson.active ? "" : "is-inactive"}`;

    const top = document.createElement("div");
    top.className = "admin-lesson-top";
    const title = document.createElement("input");
    title.value = lesson.title || lesson.id;
    title.maxLength = 120;
    const id = document.createElement("span");
    id.textContent = `ID: ${lesson.id}`;
    top.append(title, id);

    const members = document.createElement("div");
    members.className = "admin-member-grid";
    const teacherWrap = document.createElement("label");
    teacherWrap.textContent = "Учителя";
    const teachers = memberPicker("teacher", lesson.teacherIds || []);
    teacherWrap.append(teachers);
    const studentWrap = document.createElement("label");
    studentWrap.textContent = "Ученики";
    const students = memberPicker("student", lesson.studentIds || []);
    studentWrap.append(students);
    members.append(teacherWrap, studentWrap);

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Сохранить";
    save.addEventListener("click", async () => {
      try {
        await apiJson(`/api/admin/lessons/${encodeURIComponent(lesson.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: title.value,
            teacherIds: selectedValues(teachers),
            studentIds: selectedValues(students),
          }),
        });
        setAdminStatus("Урок обновлён", "success");
        await loadAdminData();
        await refreshVisibleLessons();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary";
    toggle.textContent = lesson.active ? "Деактивировать" : "Активировать";
    toggle.addEventListener("click", async () => {
      try {
        await apiJson(`/api/admin/lessons/${encodeURIComponent(lesson.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !lesson.active }),
        });
        setAdminStatus(lesson.active ? "Урок деактивирован" : "Урок активирован", "success");
        await loadAdminData();
        await refreshVisibleLessons();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });
    actions.append(save, toggle);

    row.append(top, members, actions);
    adminLessonList.append(row);
  }
}

async function loadAdminData() {
  const [usersPayload, lessonsPayload] = await Promise.all([
    apiJson("/api/admin/users"),
    apiJson("/api/admin/lessons"),
  ]);
  managedUsers = usersPayload.users || [];
  managedLessons = lessonsPayload.lessons || [];
  if (adminUsersCount) adminUsersCount.textContent = String(managedUsers.length);
  if (adminLessonsCount) adminLessonsCount.textContent = String(managedLessons.length);
  renderAdminMemberChoices();
  renderAdminUsers();
  renderAdminLessons();
}

async function refreshVisibleLessons() {
  const payload = await apiJson("/api/lessons");
  renderLessons(currentUser, payload.lessons || []);
}

createUserForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(createUserForm);
  try {
    await apiJson("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        displayName: form.get("displayName"),
        role: form.get("role"),
        password: form.get("password"),
      }),
    });
    createUserForm.reset();
    setAdminStatus("Пользователь создан", "success");
    await loadAdminData();
  } catch (error) {
    setAdminStatus(`Ошибка: ${error.message}`, "error");
  }
});

createLessonForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(createLessonForm);
  try {
    await apiJson("/api/admin/lessons", {
      method: "POST",
      body: JSON.stringify({
        id: form.get("id"),
        title: form.get("title"),
        teacherIds: selectedValues(newLessonTeachers),
        studentIds: selectedValues(newLessonStudents),
      }),
    });
    createLessonForm.reset();
    renderAdminMemberChoices();
    setAdminStatus("Урок создан", "success");
    await loadAdminData();
    await refreshVisibleLessons();
  } catch (error) {
    setAdminStatus(`Ошибка: ${error.message}`, "error");
  }
});

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
  currentUser = user;
  accountName.textContent = `${user.displayName || user.username} · ${user.role}`;

  if (user.role === "teacher") {
    studentCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Выберите урок. Каждый урок имеет отдельные PDF, пометки и realtime.";
  } else if (user.role === "student") {
    teacherCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Выберите урок. Материалы и пометки разделены между уроками.";
  } else {
    adminPanel.hidden = false;
    showAdminView("overview");
    note.textContent = "Управление пользователями и уроками вынесено в отдельные разделы.";
    await loadAdminData();
  }

  renderLessons(user, lessons);
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/");
});

loadAccount().catch(() => location.replace("/"));
