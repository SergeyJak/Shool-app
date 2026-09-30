const dialog = document.getElementById("helpDialog");
const accountName = document.getElementById("accountName");
const teacherCard = document.querySelector(".role-teacher");
const studentCard = document.querySelector(".role-student");
const perfButton = document.getElementById("perfLogButton");
const note = document.getElementById("landingNote");

document.getElementById("infoBtn").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

async function loadAccount() {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (res.status === 401) {
    location.replace("/");
    return;
  }
  const { user } = await res.json();
  accountName.textContent = `${user.displayName || user.username} · ${user.role}`;

  if (user.role === "teacher") {
    studentCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Ваш кабинет учителя. Сейчас здесь один активный урок, позже появятся уроки, ученики и учебники.";
  } else if (user.role === "student") {
    teacherCard.hidden = true;
    perfButton.hidden = true;
    note.textContent = "Ваш кабинет ученика. Сейчас здесь один активный урок, позже появятся уроки и учебники.";
  } else {
    note.textContent = "Администратор может открыть обе стороны текущего урока.";
  }
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/");
});

loadAccount().catch(() => location.replace("/"));
