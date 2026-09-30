const form = document.getElementById("loginForm");
const button = document.getElementById("loginBtn");
const errorEl = document.getElementById("loginError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = "Входим…";
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = data.error === "INVALID_CREDENTIALS"
        ? "Неверный логин или пароль."
        : "Не удалось войти. Попробуйте ещё раз.";
      errorEl.hidden = false;
      return;
    }
    location.replace(data.redirect || "/cabinet");
  } catch {
    errorEl.textContent = "Нет связи с сервером.";
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Войти";
  }
});
