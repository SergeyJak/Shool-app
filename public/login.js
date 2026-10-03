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
      const messages = {
        INVALID_CREDENTIALS: "Неверный логин или пароль.",
        ACCOUNT_PENDING: "Регистрация ожидает подтверждения администратора.",
        ACCOUNT_REJECTED: "Регистрация отклонена администратором.",
        ACCOUNT_INACTIVE: "Аккаунт отключён администратором.",
        TOO_MANY_ATTEMPTS: "Слишком много попыток входа. Подождите немного и попробуйте снова.",
      };
      errorEl.textContent = messages[data.error] || "Не удалось войти. Попробуйте ещё раз.";
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
