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
  preferAccount = false,
  secret,
  findActiveUserById,
}) {
  const cookies = parseCookies(cookieHeader || "");
  const guest = parseGuestToken(cookies[GUEST_COOKIE], secret);
  const session = parseSessionToken(cookies[SESSION_COOKIE], secret);
  let sessionUser = null;

  // Admin account must never be shadowed by a room guest cookie. This is
  // especially important for lesson-scoped HTTP requests and Socket.IO.
  if (session?.uid && (preferAccount || session.role === "admin")) {
    sessionUser = await findActiveUserById(session.uid);
    if (sessionUser && (preferAccount || sessionUser.role === "admin")) {
      return sessionUser;
    }
  }

  if (!preferAccount && guest && preferredLessonId && guest.lessonId === preferredLessonId) {
    return guestIdentity(guest);
  }

  if (session?.uid) {
    sessionUser ||= await findActiveUserById(session.uid);
    if (sessionUser) return sessionUser;
  }

  return guestIdentity(guest);
}

module.exports = { guestIdentity, resolveIdentityFromCookies };
