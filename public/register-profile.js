const form = document.getElementById("profileForm");
const button = document.getElementById("profileBtn");
const errorEl = document.getElementById("profileError");

async function verifyRegistration() {
  const response = await fetch("/api/auth/registration", { cache: "no-store" });
  if (!response.ok) location.replace("/register");
}
verifyRegistration().catch(() => location.replace("/register"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = "Отправляем…";

  const data = new FormData(form);
  try {
    const response = await fetch("/api/auth/register/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: data.get("firstName"),
        lastName: data.get("lastName"),
        email: data.get("email"),
        birthDate: data.get("birthDate"),
        phone: data.get("phone"),
        subjects: data.get("subjects"),
        bio: data.get("bio"),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        FIRST_NAME_REQUIRED: "Введите имя.",
        INVALID_EMAIL: "Проверьте email.",
        INVALID_BIRTH_DATE: "Проверьте дату рождения.",
        REGISTRATION_REQUIRED: "Сессия регистрации истекла. Войдите снова.",
      };
      throw new Error(messages[payload.error] || "Не удалось сохранить профиль.");
    }
    location.replace(payload.redirect || "/registration-pending");
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    button.disabled = false;
    button.textContent = "Отправить на проверку";
  }
});