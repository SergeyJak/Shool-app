const form = document.getElementById("registerForm");
const button = document.getElementById("registerBtn");
const errorEl = document.getElementById("registerError");

const messages = {
  INVALID_USERNAME: "Логин должен содержать 3–50 символов: буквы, цифры, точку, дефис или подчёркивание.",
  INVALID_PASSWORD: "Пароль должен быть длиной от 8 до 128 символов.",
  PASSWORD_MISMATCH: "Пароли не совпадают.",
  USER_EXISTS: "Такой логин уже занят.",
  TOO_MANY_ATTEMPTS: "Слишком много регистраций с этого подключения. Попробуйте позже.",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;

  const data = new FormData(form);
  const password = String(data.get("password") || "");
  const passwordConfirm = String(data.get("passwordConfirm") || "");
  if (password !== passwordConfirm) {
    errorEl.textContent = messages.PASSWORD_MISMATCH;
    errorEl.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = "Регистрируем…";
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password,
        passwordConfirm,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "REGISTRATION_FAILED");
    location.replace(payload.redirect || "/register/profile");
  } catch (error) {
    errorEl.textContent = messages[error.message] || "Не удалось зарегистрироваться. Попробуйте ещё раз.";
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Зарегистрироваться";
  }
});