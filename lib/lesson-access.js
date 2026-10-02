function canAccessLesson(user, lesson) {
  if (!user || !lesson) return false;
  if (user.guest) return lesson.active !== false && user.lessonId === lesson._id;
  if (user.role === "admin") return true;
  if (user.role === "teacher") {
    return lesson.ownerId === user._id || lesson.teacherIds?.includes(user._id);
  }
  if (user.role === "student") {
    return lesson.active !== false && lesson.studentIds?.includes(user._id);
  }
  return false;
}

module.exports = { canAccessLesson };
