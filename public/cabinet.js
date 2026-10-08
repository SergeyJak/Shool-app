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
const teacherSessionTabs = document.getElementById("teacherSessionTabs");
const teacherTabButtons = [...document.querySelectorAll("[data-teacher-view]")];
const materialPanel = document.getElementById("materialPanel");
const materialUploadForm = document.getElementById("materialUploadForm");
const materialStatus = document.getElementById("materialStatus");
const materialList = document.getElementById("materialList");
const statActiveSessions = document.getElementById("statActiveSessions");
const statMaterials = document.getElementById("statMaterials");
const statSubmissions = document.getElementById("statSubmissions");
const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const adminUserList = document.getElementById("adminUserList");
const adminLessonList = document.getElementById("adminLessonList");
const adminRegistrationList = document.getElementById("adminRegistrationList");
const registrationBadge = document.getElementById("registrationBadge");
const adminRegistrationsCount = document.getElementById("adminRegistrationsCount");
const createUserForm = document.getElementById("createUserForm");
const createLessonForm = document.getElementById("createLessonForm");
const newLessonTeachers = document.getElementById("newLessonTeachers");
const newLessonStudents = document.getElementById("newLessonStudents");
const adminNavButtons = [...document.querySelectorAll("[data-admin-view]")];
const adminSections = [...document.querySelectorAll("[data-admin-section]")];
const adminUsersCount = document.getElementById("adminUsersCount");
const adminLessonsCount = document.getElementById("adminLessonsCount");
const userStateButtons = [...document.querySelectorAll("[data-user-state]")];
const lessonStateButtons = [...document.querySelectorAll("[data-lesson-state]")];
const activeUsersCount = document.getElementById("activeUsersCount");
const inactiveUsersCount = document.getElementById("inactiveUsersCount");
const activeLessonsCount = document.getElementById("activeLessonsCount");
const inactiveLessonsCount = document.getElementById("inactiveLessonsCount");
const paymentBrotherBalance = document.getElementById("paymentBrotherBalance");
const paymentTeacherBalance = document.getElementById("paymentTeacherBalance");
const paymentSpentTotal = document.getElementById("paymentSpentTotal");
const paymentDepositForm = document.getElementById("paymentDepositForm");
const paymentAccountForm = document.getElementById("paymentAccountForm");
const paymentAllocationForm = document.getElementById("paymentAllocationForm");
const paymentTeacherId = document.getElementById("paymentTeacherId");
const paymentAccountId = document.getElementById("paymentAccountId");
const paymentDepositDate = document.getElementById("paymentDepositDate");
const paymentAllocationDate = document.getElementById("paymentAllocationDate");
const paymentAccountsList = document.getElementById("paymentAccountsList");
const paymentDepositsBody = document.getElementById("paymentDepositsBody");

let currentUser = null;
let managedUsers = [];
let managedLessons = [];
let pendingRegistrations = [];
let teacherMaterials = [];
let teacherView = "active";
let adminUserState = "active";
let adminLessonState = "active";
let paymentData = {
  summary: { depositsTotal: 0, brotherBalance: 0, teacherBalance: 0, spentTotal: 0 },
  teachers: [],
  accounts: [],
  deposits: [],
  allocations: [],
  lessons: [],
};

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
  button.addEventListener("click", async () => {
    showAdminView(button.dataset.adminView);
    if (button.dataset.adminView === "payments") {
      try {
        await loadPaymentData();
      } catch (error) {
        setAdminStatus(`Ошибка оплат: ${error.message}`, "error");
      }
    }
  });
}

for (const button of userStateButtons) {
  button.addEventListener("click", () => {
    adminUserState = button.dataset.userState === "inactive" ? "inactive" : "active";
    for (const tab of userStateButtons) tab.classList.toggle("active", tab === button);
    renderAdminUsers();
  });
}

for (const button of lessonStateButtons) {
  button.addEventListener("click", () => {
    adminLessonState = button.dataset.lessonState === "inactive" ? "inactive" : "active";
    for (const tab of lessonStateButtons) tab.classList.toggle("active", tab === button);
    renderAdminLessons();
  });
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
  if (statMaterials) statMaterials.textContent = String(teacherMaterials.length);
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
  if (user.role === "teacher" && teacherView === "active") {
    if (statActiveSessions) statActiveSessions.textContent = String(lessons.length);
    if (statSubmissions) {
      statSubmissions.textContent = String(
        lessons.reduce((sum, lesson) => sum + Number(lesson.submissionCount || 0), 0)
      );
    }
  }

  if (!lessons.length) {
    note.textContent = user.role === "teacher"
      ? (teacherView === "archive" ? "Архив пока пуст." : "Пока нет занятий. Создайте первый урок или домашнюю работу.")
      : "Для этого аккаунта пока нет активных уроков.";
    return;
  }

  if (lessonSectionTitle) {
    lessonSectionTitle.textContent = user.role === "teacher"
      ? (teacherView === "archive" ? "Архив" : "Мои занятия")
      : "Мои уроки";
  }

  for (const lesson of lessons) {
    const item = document.createElement("div");
    item.className = `lesson-card lesson-type-${lesson.type === "homework" ? "homework" : "lesson"}`;

    const copy = document.createElement("div");
    copy.className = "lesson-card-copy";
    const title = document.createElement("strong");
    title.textContent = lesson.title || lesson.id;
    const meta = document.createElement("span");
    if (user.role === "teacher") {
      const parts = [lesson.type === "homework" ? "Домашняя работа" : "Урок"];
      if (lesson.lastParticipantName) {
        const joined = lesson.lastParticipantAt ? new Date(lesson.lastParticipantAt).toLocaleString() : "";
        parts.push(`Ученик: ${lesson.lastParticipantName}${joined ? ` · ${joined}` : ""}`);
      }
      if (teacherView === "archive" && lesson.archivedAt) {
        parts.push(`Завершено: ${new Date(lesson.archivedAt).toLocaleString()}`);
      }
      meta.textContent = parts.join(" · ");
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
      openLink.textContent = teacherView === "archive" ? "Открыть" : "Продолжить";

      if (teacherView === "archive") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger-action";
        remove.textContent = "Удалить навсегда";
        remove.addEventListener("click", async () => {
          if (!confirm(`Удалить «${lesson.title}» навсегда? Это удалит рисунки и данные сессии.`)) return;
          try {
            await apiJson(`/api/teacher/lessons/${encodeURIComponent(lesson.id)}`, { method: "DELETE" });
            setTeacherStatus("Сессия удалена", "success");
            await refreshVisibleLessons();
          } catch (error) {
            setTeacherStatus(`Ошибка: ${error.message}`, "error");
          }
        });
        actions.append(openLink, remove);
      } else {
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

        const finish = document.createElement("button");
        finish.type = "button";
        finish.className = "secondary-action";
        finish.textContent = "Завершить";
        finish.addEventListener("click", async () => {
          try {
            await apiJson(`/api/teacher/lessons/${encodeURIComponent(lesson.id)}/archive`, { method: "POST" });
            setTeacherStatus("Сессия перенесена в архив", "success");
            await refreshVisibleLessons();
          } catch (error) {
            setTeacherStatus(`Ошибка: ${error.message}`, "error");
          }
        });
        actions.append(finish);

        const materialControls = materialPicker(lesson);
        item.append(materialControls);
      }

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

function renderAdminRegistrations() {
  if (!adminRegistrationList) return;
  adminRegistrationList.innerHTML = "";

  if (!pendingRegistrations.length) {
    const empty = document.createElement("p");
    empty.className = "admin-overview-note";
    empty.textContent = "Новых заявок нет.";
    adminRegistrationList.append(empty);
    return;
  }

  for (const registration of pendingRegistrations) {
    const card = document.createElement("article");
    card.className = "registration-card";

    const header = document.createElement("div");
    header.className = "registration-card-header";
    const title = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = registration.displayName || registration.username;
    const login = document.createElement("span");
    login.textContent = `@${registration.username}`;
    title.append(name, login);

    const submitted = document.createElement("small");
    submitted.textContent = registration.registrationSubmittedAt
      ? new Date(registration.registrationSubmittedAt).toLocaleString()
      : "";
    header.append(title, submitted);

    const details = document.createElement("dl");
    details.className = "registration-details";
    const items = [
      ["Email", registration.email || "—"],
      ["Дата рождения", registration.birthDate || "—"],
      ["Телефон", registration.phone || "—"],
      ["Предметы", registration.subjects || "—"],
      ["О себе", registration.bio || "—"],
    ];
    for (const [label, value] of items) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      details.append(dt, dd);
    }

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Одобрить";
    approve.addEventListener("click", async () => {
      try {
        await apiJson(`/api/admin/registrations/${encodeURIComponent(registration.id)}/approve`, { method: "POST" });
        setAdminStatus("Регистрация одобрена", "success");
        await loadAdminData();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "danger";
    reject.textContent = "Отклонить";
    reject.addEventListener("click", async () => {
      if (!confirm(`Отклонить регистрацию ${registration.displayName || registration.username}?`)) return;
      try {
        await apiJson(`/api/admin/registrations/${encodeURIComponent(registration.id)}/reject`, { method: "POST" });
        setAdminStatus("Регистрация отклонена", "success");
        await loadAdminData();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });

    actions.append(approve, reject);
    card.append(header, details, actions);
    adminRegistrationList.append(card);
  }
}

function renderAdminUsers() {
  adminUserList.innerHTML = "";
  const visibleUsers = managedUsers.filter((user) => adminUserState === "active" ? user.active : !user.active);
  if (!visibleUsers.length) {
    const empty = document.createElement("p");
    empty.className = "admin-overview-note";
    empty.textContent = adminUserState === "active" ? "Активных пользователей нет." : "Деактивированных пользователей нет.";
    adminUserList.append(empty);
    return;
  }
  for (const user of visibleUsers) {
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
  const visibleLessons = managedLessons.filter((lesson) => adminLessonState === "active" ? lesson.active : !lesson.active);
  if (!visibleLessons.length) {
    const empty = document.createElement("p");
    empty.className = "admin-overview-note";
    empty.textContent = adminLessonState === "active" ? "Активных уроков нет." : "Деактивированных уроков нет.";
    adminLessonList.append(empty);
    return;
  }
  for (const lesson of visibleLessons) {
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


function formatRubles(value) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(value) || 0)} ₽`;
}

function localIsoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function teacherName(teacherId) {
  const teacher = paymentData.teachers.find((item) => item.id === teacherId)
    || managedUsers.find((item) => item.id === teacherId);
  return teacher?.displayName || teacher?.username || teacherId;
}

function paymentLessonDates(accountId) {
  return new Set(
    paymentData.lessons
      .filter((lesson) => lesson.accountId === accountId)
      .map((lesson) => lesson.date)
  );
}

function fillPaymentSelects() {
  if (paymentTeacherId) {
    const selected = paymentTeacherId.value;
    paymentTeacherId.innerHTML = "";
    const teachers = paymentData.teachers.length
      ? paymentData.teachers
      : managedUsers.filter((user) => user.role === "teacher" && user.active);
    for (const teacher of teachers) {
      const option = document.createElement("option");
      option.value = teacher.id;
      option.textContent = teacher.displayName || teacher.username;
      paymentTeacherId.append(option);
    }
    if ([...paymentTeacherId.options].some((option) => option.value === selected)) {
      paymentTeacherId.value = selected;
    }
  }

  if (paymentAccountId) {
    const selected = paymentAccountId.value;
    paymentAccountId.innerHTML = "";
    for (const account of paymentData.accounts.filter((item) => item.active)) {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.subject} · ${teacherName(account.teacherId)} · ${formatRubles(account.lessonPrice)}`;
      paymentAccountId.append(option);
    }
    if ([...paymentAccountId.options].some((option) => option.value === selected)) {
      paymentAccountId.value = selected;
    }
  }
}

function buildPaymentCalendar(account) {
  const wrapper = document.createElement("div");
  wrapper.className = "payment-calendar";

  const monthCursor = new Date();
  monthCursor.setDate(1);

  const header = document.createElement("div");
  header.className = "payment-calendar-header";
  const title = document.createElement("strong");
  title.textContent = monthCursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const hint = document.createElement("span");
  hint.textContent = "Нажмите на день, чтобы отметить или отменить занятие";
  header.append(title, hint);

  const weekdays = document.createElement("div");
  weekdays.className = "payment-calendar-weekdays";
  for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
    const cell = document.createElement("span");
    cell.textContent = day;
    weekdays.append(cell);
  }

  const grid = document.createElement("div");
  grid.className = "payment-calendar-grid";
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const marked = paymentLessonDates(account.id);

  for (let i = 0; i < firstWeekday; i += 1) {
    const spacer = document.createElement("span");
    spacer.className = "payment-calendar-spacer";
    grid.append(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "payment-calendar-day";
    button.textContent = String(day);
    button.classList.toggle("is-lesson", marked.has(date));
    button.title = marked.has(date)
      ? `Занятие ${formatRubles(account.lessonPrice)}. Нажмите, чтобы отменить.`
      : `Отметить занятие за ${formatRubles(account.lessonPrice)}`;

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (marked.has(date)) {
          await apiJson(`/api/admin/payments/accounts/${encodeURIComponent(account.id)}/lessons/${date}`, {
            method: "DELETE",
          });
          setAdminStatus("Занятие отменено, сумма возвращена", "success");
        } else {
          await apiJson(`/api/admin/payments/accounts/${encodeURIComponent(account.id)}/lessons`, {
            method: "POST",
            body: JSON.stringify({ date }),
          });
          setAdminStatus(`Занятие отмечено: −${formatRubles(account.lessonPrice)}`, "success");
        }
        await loadPaymentData();
      } catch (error) {
        const message = error.message === "INSUFFICIENT_TEACHER_BALANCE"
          ? "Недостаточно денег на счёте учителя"
          : error.message;
        setAdminStatus(`Ошибка: ${message}`, "error");
        button.disabled = false;
      }
    });
    grid.append(button);
  }

  wrapper.append(header, weekdays, grid);
  return wrapper;
}

function renderPaymentAccounts() {
  if (!paymentAccountsList) return;
  paymentAccountsList.innerHTML = "";

  if (!paymentData.accounts.length) {
    const empty = document.createElement("p");
    empty.className = "admin-overview-note";
    empty.textContent = "Сначала создайте счёт учителя / предмета.";
    paymentAccountsList.append(empty);
    return;
  }

  for (const account of paymentData.accounts.filter((item) => item.active)) {
    const card = document.createElement("article");
    card.className = "payment-account-card";

    const top = document.createElement("div");
    top.className = "payment-account-top";
    const title = document.createElement("div");
    const name = document.createElement("h4");
    name.textContent = account.subject;
    const meta = document.createElement("span");
    meta.textContent = `${teacherName(account.teacherId)} · ${formatRubles(account.lessonPrice)} / занятие`;
    title.append(name, meta);

    const balance = document.createElement("div");
    balance.className = "payment-account-balance";
    const balanceValue = document.createElement("strong");
    balanceValue.textContent = formatRubles(account.balance);
    const balanceMeta = document.createElement("span");
    balanceMeta.textContent = `${account.fullLessonsLeft} полных урока + ${formatRubles(account.remainderAfterLessons)}`;
    balance.append(balanceValue, balanceMeta);
    top.append(title, balance);

    const stats = document.createElement("div");
    stats.className = "payment-account-stats";
    stats.innerHTML = `
      <span>Передано <b>${formatRubles(account.allocated)}</b></span>
      <span>Проведено <b>${Math.round(account.spent / account.lessonPrice) || 0}</b></span>
      <span>Списано <b>${formatRubles(account.spent)}</b></span>
    `;

    card.append(top, stats, buildPaymentCalendar(account));
    paymentAccountsList.append(card);
  }
}

function renderPaymentDeposits() {
  if (!paymentDepositsBody) return;
  paymentDepositsBody.innerHTML = "";
  if (!paymentData.deposits.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="4" class="payment-empty-cell">Взносов пока нет</td>';
    paymentDepositsBody.append(row);
    return;
  }

  for (const deposit of paymentData.deposits) {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = new Date(`${deposit.date}T00:00:00`).toLocaleDateString("ru-RU");
    const amount = document.createElement("td");
    amount.innerHTML = `<strong>${formatRubles(deposit.amount)}</strong>`;
    const note = document.createElement("td");
    note.textContent = deposit.note || "—";
    const actions = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "payment-delete";
    del.textContent = "Удалить";
    del.addEventListener("click", async () => {
      if (!confirm(`Удалить взнос ${formatRubles(deposit.amount)} от ${date.textContent}?`)) return;
      try {
        await apiJson(`/api/admin/payments/deposits/${encodeURIComponent(deposit.id)}`, { method: "DELETE" });
        setAdminStatus("Взнос удалён", "success");
        await loadPaymentData();
      } catch (error) {
        setAdminStatus(`Ошибка: ${error.message}`, "error");
      }
    });
    actions.append(del);
    row.append(date, amount, note, actions);
    paymentDepositsBody.append(row);
  }
}

function renderPaymentData() {
  if (paymentBrotherBalance) paymentBrotherBalance.textContent = formatRubles(paymentData.summary?.brotherBalance);
  if (paymentTeacherBalance) paymentTeacherBalance.textContent = formatRubles(paymentData.summary?.teacherBalance);
  if (paymentSpentTotal) paymentSpentTotal.textContent = formatRubles(paymentData.summary?.spentTotal);
  fillPaymentSelects();
  renderPaymentAccounts();
  renderPaymentDeposits();
}

async function loadPaymentData() {
  paymentData = await apiJson("/api/admin/payments");
  renderPaymentData();
}

async function loadAdminData() {
  const [registrationsPayload, usersPayload, lessonsPayload] = await Promise.all([
    apiJson("/api/admin/registrations"),
    apiJson("/api/admin/users"),
    apiJson("/api/admin/lessons"),
  ]);
  pendingRegistrations = registrationsPayload.registrations || [];
  managedUsers = usersPayload.users || [];
  managedLessons = lessonsPayload.lessons || [];
  if (adminRegistrationsCount) adminRegistrationsCount.textContent = String(pendingRegistrations.length);
  if (registrationBadge) {
    registrationBadge.textContent = String(pendingRegistrations.length);
    registrationBadge.hidden = pendingRegistrations.length === 0;
  }
  const activeUsers = managedUsers.filter((user) => user.active).length;
  const inactiveUsers = managedUsers.length - activeUsers;
  const activeLessons = managedLessons.filter((lesson) => lesson.active).length;
  const inactiveLessons = managedLessons.length - activeLessons;
  if (adminUsersCount) adminUsersCount.textContent = String(activeUsers);
  if (adminLessonsCount) adminLessonsCount.textContent = String(activeLessons);
  if (activeUsersCount) activeUsersCount.textContent = String(activeUsers);
  if (inactiveUsersCount) inactiveUsersCount.textContent = String(inactiveUsers);
  if (activeLessonsCount) activeLessonsCount.textContent = String(activeLessons);
  if (inactiveLessonsCount) inactiveLessonsCount.textContent = String(inactiveLessons);
  renderAdminRegistrations();
  renderAdminMemberChoices();
  renderAdminUsers();
  renderAdminLessons();
}

async function refreshVisibleLessons() {
  const suffix = currentUser?.role === "teacher" && teacherView === "archive" ? "?archive=1" : "";
  const payload = await apiJson(`/api/lessons${suffix}`);
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


for (const input of [paymentDepositDate, paymentAllocationDate]) {
  if (input && !input.value) input.value = localIsoDate();
}

paymentDepositForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(paymentDepositForm);
  try {
    await apiJson("/api/admin/payments/deposits", {
      method: "POST",
      body: JSON.stringify({
        amount: Number(form.get("amount")),
        date: form.get("date"),
        note: form.get("note"),
      }),
    });
    paymentDepositForm.reset();
    paymentDepositDate.value = localIsoDate();
    setAdminStatus("Взнос добавлен", "success");
    await loadPaymentData();
  } catch (error) {
    setAdminStatus(`Ошибка: ${error.message}`, "error");
  }
});

paymentAccountForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(paymentAccountForm);
  try {
    await apiJson("/api/admin/payments/accounts", {
      method: "POST",
      body: JSON.stringify({
        teacherId: form.get("teacherId"),
        subject: form.get("subject"),
        lessonPrice: Number(form.get("lessonPrice")),
      }),
    });
    paymentAccountForm.reset();
    setAdminStatus("Счёт учителя создан", "success");
    await loadPaymentData();
  } catch (error) {
    setAdminStatus(`Ошибка: ${error.message}`, "error");
  }
});

paymentAllocationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(paymentAllocationForm);
  try {
    await apiJson("/api/admin/payments/allocations", {
      method: "POST",
      body: JSON.stringify({
        accountId: form.get("accountId"),
        amount: Number(form.get("amount")),
        date: form.get("date"),
        note: form.get("note"),
      }),
    });
    paymentAllocationForm.reset();
    paymentAllocationDate.value = localIsoDate();
    setAdminStatus("Сумма распределена учителю", "success");
    await loadPaymentData();
  } catch (error) {
    const message = error.message === "INSUFFICIENT_BROTHER_BALANCE"
      ? "У брата недостаточно нераспределённых денег"
      : error.message;
    setAdminStatus(`Ошибка: ${message}`, "error");
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
  document.body.dataset.role = user.role;
  const roleLabel = user.role === "teacher" ? "учитель" : user.role === "admin" ? "администратор" : "ученик";
  accountName.textContent = `${user.displayName || user.username} · ${roleLabel}`;

  if (user.role === "teacher") {
    perfButton.hidden = true;
    teacherPanel.hidden = false;
    materialPanel.hidden = false;
    teacherSessionTabs.hidden = false;
    cabinetLead.textContent = "Создавайте уроки и домашние работы, отправляйте ребёнку ссылку и возвращайтесь к любой сессии позже.";
    note.textContent = lessons.length ? "" : "Создайте первое занятие.";
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

for (const button of teacherTabButtons) {
  button.addEventListener("click", async () => {
    teacherView = button.dataset.teacherView === "archive" ? "archive" : "active";
    for (const tab of teacherTabButtons) {
      tab.classList.toggle("active", tab === button);
    }
    await refreshVisibleLessons();
  });
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
