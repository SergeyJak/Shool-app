const {
  SESSION_COOKIE,
  GUEST_COOKIE,
  parseSessionToken,
  parseGuestToken,
  parseCookies,
} = require("./auth");

function guestIdentity(guest) {
  if (!guest) return null;
  return {
    _id: `guest:${guest.guestId}`,
    username: guest.name || "guest",
    displayName: guest.name || "Ученик",
    role: "student",
    active: true,
    guest: true,
    lessonId: guest.lessonId,
  };
}

async function resolveIdentityFromCookies({
  cookieHeader,
  preferredLessonId = null,
  secret,
  findActiveUserById,
}) {
  const cookies = parseCookies(cookieHeader || "");
  const guest = parseGuestToken(cookies[GUEST_COOKIE], secret);

  if (guest && preferredLessonId && guest.lessonId === preferredLessonId) {
    return guestIdentity(guest);
  }

  const session = parseSessionToken(cookies[SESSION_COOKIE], secret);
  if (session?.uid) {
    const user = await findActiveUserById(session.uid);
    if (user) return user;
  }

  return guestIdentity(guest);
}

module.exports = { guestIdentity, resolveIdentityFromCookies };
