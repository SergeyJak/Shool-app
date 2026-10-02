const dialog = document.getElementById("helpDialog");
const accountName = document.getElementById("accountName");
const perfButton = document.getElementById("perfLogButton");
const note = document.getElementById("landingNote");
const lessonSection = document.getElementById("lessonSection");
const lessonList = document.getElementById("lessonList");
const teacherPanel = document.getElementById("teacherPanel");
const createTeacherSessionForm = document.getElementById("createTeacherSessionForm");
const teacherSessionStatus = document.getElementById("teacherSessionStatus");
const lessonSectionTitle = document.getElementById("lessonSectionTitle");
const cabinetLead = document.getElementById("cabinetLead");
const materialPanel = document.getElementById("materialPanel");
const materialUploadForm = document.getElementById("materialUploadForm");
const materialStatus = document.getElementById("materialStatus");
const materialList = document.getElementById("materialList");
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
let teacherMaterials = [];

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

function setTeacherStatus(message, type = "") {
  if (!teacherSessionStatus) return;
  teacherSessionStatus.textContent = message;
  teacherSessionStatus.dataset.type = type;
}

async function copyInvite(inviteUrl) {
  const url = new URL(inviteUrl, location.origin).href;
  await navigator.clipboard.writeText(url);
  return url;
}

function setMaterialStatus(message, type = "") {
  if (!materialStatus) return;
  materialStatus.textContent = message;
  materialStatus.dataset.type = type;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function loadMaterials() {
  if (!currentUser || currentUser.role !== "teacher") return;
  const payload = await apiJson("/api/materials");
  teacherMaterials = payload.materials || [];
  renderMaterials();
}

function renderMaterials() {
  if (!materialList) return;
  materialList.innerHTML = "";
  if (!teacherMaterials.length) {
    const empty = document.createElement("p");
    empty.className = "material-empty";
    empty.textContent = "Материалов пока нет. Загрузите первый PDF.";
    materialList.append(empty);
    return;
  }

  for (const material of teacherMaterials) {
    const row = document.createElement("div");
    row.className = "material-row";

    const info = document.createElement("div");
    info.className = "material-row-copy";
    const title = document.createElement("strong");
    title.textContent = material.name;
    const meta = document.createElement("span");
    meta.textContent = formatBytes(material.storedSize);
    info.append(title, meta);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary-action";
    del.textContent = "Удалить";
    del.addEventListener("click", async () => {
      try {
        await apiJson(`/api/materials/${encodeURIComponent(material.id)}`, { method: "DELETE" });
        setMaterialStatus("Материал удалён", "success");
        await loadMaterials();
        await refreshVisibleLessons();
      } catch (error) {
        setMaterialStatus(
          error.message === "MATERIAL_IN_USE"
            ? "Этот PDF используется в активном занятии."
            : `Ошибка: ${error.message}`,
          "error"
        );
      }
    });

    row.append(info, del);
    materialList.append(row);
  }
}

function materialPicker(lesson) {
  const wrap = document.createElement("div");
  wrap.className = "lesson-material";

  const select = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = teacherMaterials.length ? "Выбрать PDF" : "Нет материалов";
  select.append(empty);

  for (const material of teacherMaterials) {
    const option = document.createElement("option");
    option.value = material.id;
    option.textContent = material.name;
    option.selected = material.id === lesson.materialId;
    select.append(option);
  }

  const attach = document.createElement("button");
  attach.type = "button";
  attach.className = "secondary-action";
  attach.textContent = lesson.materialId ? "Сменить PDF" : "Прикрепить PDF";
  attach.disabled = !teacherMaterials.length;
  attach.addEventListener("click", async () => {
    if (!select.value) {
      setTeacherStatus("Сначала выберите PDF", "error");
      return;
    }
    try {
      await apiJson(`/api/teacher/lessons/${encodeURIComponent(lesson.id)}/material`, {
        method: "PATCH",
        body: JSON.stringify({ materialId: select.value }),
      });
      setTeacherStatus("Материал прикреплён ✓", "success");
      await refreshVisibleLessons();
    } catch (error) {
      setTeacherStatus(`Ошибка: ${error.message}`, "error");
    }
  });

  wrap.append(select, attach);
  return wrap;
}

async function showSubmissions(lesson, container) {
  try {
    const payload = await apiJson(`/api/teacher/lessons/${encodeURIComponent(lesson.id)}/submissions`);
    container.innerHTML = "";
    const rows = payload.submissions || [];
    if (!rows.length) {
      container.textContent = "Пока никто не сдал.";
      return;
    }
    for (const item of rows) {
      const row = document.createElement("div");
      row.className = "submission-row";
      const when = item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "";
      row.textContent = `${item.participantName || "Ученик"} · ${when}`;
      container.append(row);
    }
  } catch (error) {
    container.textContent = `Ошибка: ${error.message}`;
  }
}

function renderLessons(user, lessons) {
  lessonList.innerHTML = "";
  lessonSection.hidden = lessons.length === 0;

  if (!lessons.length) {
    note.textContent = user.role === "teacher"
      ? "Пока нет занятий. Создайте первый урок или домашнюю работу."
      : "Для этого аккаунта пока нет активных уроков.";
    return;
  }

  if (lessonSectionTitle) {
    lessonSectionTitle.textContent = user.role === "teacher" ? "Мои занятия" : "Мои уроки";
  }

  for (const lesson of lessons) {
    const item = document.createElement("div");
    item.className = "lesson-card";

    const copy = document.createElement("div");
    copy.className = "lesson-card-copy";
    const title = document.createElement("strong");
    title.textContent = lesson.title || lesson.id;
    const meta = document.createElement("span");
    if (user.role === "teacher") {
      meta.textContent = lesson.type === "homework" ? "Домашняя работа" : "Урок";
    } else {
      meta.textContent = `ID: ${lesson.id}`;
    }
    copy.append(title, meta);
    item.append(copy);

    const actions = document.createElement("div");
    actions.className = "lesson-actions";

    if (user.role === "admin") {
      const teacherLink = document.createElement("a");
      teacherLink.href = lessonUrl("teacher", lesson.id);
      teacherLink.textContent = "Как учитель";

      const studentLink = document.createElement("a");
      studentLink.href = lessonUrl("student", lesson.id);
      studentLink.textContent = "Как ученик";

      const monitorLink = document.createElement("a");
      monitorLink.href = `/monitor?lesson=${encodeURIComponent(lesson.id)}`;
      monitorLink.textContent = "Контроль";
      monitorLink.className = "secondary-action";
      actions.append(teacherLink, studentLink, monitorLink);
    } else if (user.role === "teacher") {
      const openLink = document.createElement("a");
      openLink.href = lessonUrl("teacher", lesson.id);
      openLink.textContent = "Продолжить";

      if (lesson.inviteUrl) {
        const share = document.createElement("button");
        share.type = "button";
        share.className = "secondary-action";
        share.textContent = "Скопировать ссылку";
        share.addEventListener("click", async () => {
          try {
            await copyInvite(lesson.inviteUrl);
            share.textContent = "Ссылка скопирована ✓";
            setTimeout(() => { share.textContent = "Скопировать ссылку"; }, 2200);
          } catch {
            setTeacherStatus("Не удалось скопировать ссылку", "error");
          }
        });
        actions.append(openLink, share);
      } else {
        actions.append(openLink);
      }

      const materialControls = materialPicker(lesson);
      item.append(materialControls);

      if (lesson.type === "homework") {
        const submissions = document.createElement("div");
        submissions.className = "submission-box";
        const submissionsButton = document.createElement("button");
        submissionsButton.type = "button";
        submissionsButton.className = "secondary-action";
        submissionsButton.textContent = `Сдано: ${lesson.submissionCount || 0}`;
        const submissionsList = document.createElement("div");
        submissionsList.className = "submission-list";
        submissionsList.hidden = true;
        submissionsButton.addEventListener("click", async () => {
          submissionsList.hidden = !submissionsList.hidden;
          if (!submissionsList.hidden) await showSubmissions(lesson, submissionsList);
        });
        submissions.append(submissionsButton, submissionsList);
        item.append(submissions);
      }
    } else {
      const openLink = document.createElement("a");
      openLink.href = lessonUrl("student", lesson.id);
      openLink.textContent = "Открыть урок";
      actions.append(openLink);
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

createTeacherSessionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(createTeacherSessionForm);
  setTeacherStatus("Создаём…");
  try {
    const payload = await apiJson("/api/teacher/lessons", {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        type: form.get("type"),
      }),
    });
    createTeacherSessionForm.reset();
    await refreshVisibleLessons();
    if (payload.lesson?.inviteUrl) {
      try {
        await copyInvite(payload.lesson.inviteUrl);
        setTeacherStatus("Готово. Ссылка на занятие скопирована ✓", "success");
      } catch {
        setTeacherStatus("Занятие создано. Скопируйте ссылку из списка ниже.", "success");
      }
    } else {
      setTeacherStatus("Занятие создано", "success");
    }
  } catch (error) {
    setTeacherStatus(`Ошибка: ${error.message}`, "error");
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
    perfButton.hidden = true;
    teacherPanel.hidden = false;
    materialPanel.hidden = false;
    cabinetLead.textContent = "Создавайте уроки и домашние работы, отправляйте ребёнку ссылку и возвращайтесь к любой сессии позже.";
    note.textContent = lessons.length ? "Выберите занятие или создайте новое." : "Создайте первое занятие.";
    await loadMaterials();
    renderLessons(user, lessons);
  } else if (user.role === "student") {
    perfButton.hidden = true;
    note.textContent = "Выберите урок.";
  } else {
    adminPanel.hidden = false;
    showAdminView("overview");
    note.textContent = "Управление пользователями и уроками вынесено в отдельные разделы.";
    await loadAdminData();
  }

  if (user.role !== "teacher") renderLessons(user, lessons);
}

materialUploadForm?.addEventListener("change", async (event) => {
  if (event.target?.id !== "materialPdf") return;
  const file = event.target.files?.[0];
  if (!file) return;
  setMaterialStatus("Загружаем PDF…");
  try {
    const body = new FormData();
    body.append("pdf", file);
    const response = await fetch("/api/materials", { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    setMaterialStatus("PDF добавлен в библиотеку ✓", "success");
    materialUploadForm.reset();
    await loadMaterials();
    await refreshVisibleLessons();
  } catch (error) {
    setMaterialStatus(`Ошибка: ${error.message}`, "error");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/");
});

loadAccount().catch(() => location.replace("/"));
