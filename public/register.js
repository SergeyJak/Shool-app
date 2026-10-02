const form = document.getElementById("registerForm");
const button = document.getElementById("registerBtn");
const errorEl = document.getElementById("registerError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = "Создаём…";
  const data = new FormData(form);
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: data.get("displayName"),
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (payload.error === "USER_EXISTS") throw new Error("Такой логин уже занят.");
      throw new Error("Проверьте поля. Пароль должен быть не короче 8 символов.");
    }
    location.replace(payload.redirect || "/cabinet");
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    button.disabled = false;
    button.textContent = "Создать кабинет";
  }
});