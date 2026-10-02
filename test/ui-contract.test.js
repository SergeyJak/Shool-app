const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const page of ["public/teacher.html", "public/student.html"]) {
  test(`${page} exposes drawing, erasing, hand, zoom and page navigation controls`, () => {
    const html = read(page);
    for (const id of [
      "penBtn", "eraserBtn", "handBtn", "lineBtn", "arrowBtn", "circleBtn", "ovalBtn", "undoBtn",
      "zoomOutBtn", "zoomResetBtn", "zoomInBtn",
      "firstBtn", "prevBtn", "pageInput", "nextBtn", "lastBtn",
      "pdfCanvas", "drawCanvas",
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /School App/);
  });
}

test("teacher alone gets teacher-only controls", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  assert.match(teacher, /id="pdfUpload"/);
  assert.doesNotMatch(student, /id="pdfUpload"/);
  assert.match(teacher, /id="followBtn"/);
  assert.doesNotMatch(student, /id="followBtn"/);
  assert.match(teacher, /id="textBtn"/);
  assert.match(teacher, /id="textSizeSelect"/);
  assert.doesNotMatch(student, /id="textBtn"/);
  assert.doesNotMatch(student, /id="textSizeSelect"/);
  assert.match(student, /id="followStatus"/);
  assert.doesNotMatch(teacher, /id="perfLogButton"/);
  assert.doesNotMatch(student, /id="perfLogButton"/);
});

test("cabinet exposes help, performance, and lesson-driven navigation", () => {
  const html = read("public/dashboard.html");
  const cabinet = read("public/cabinet.js");
  assert.match(html, /id="infoBtn"/);
  assert.match(html, /id="perfLogButton"/);
  assert.match(html, /href="\/performance"/);
  assert.match(html, /Как пользоваться/);
  assert.match(html, /School App/);
  assert.doesNotMatch(html, /href="\/teacher"/);
  assert.doesNotMatch(html, /href="\/student"/);
  assert.match(cabinet, /lessonUrl\("teacher", lesson\.id\)/);
  assert.match(cabinet, /\/monitor\?lesson=/);
});

test("client keeps PDF cache versioning, loading progress and page persistence", () => {
  const js = read("public/app.js");
  assert.match(js, /document\/file\?id=/);
  assert.match(js, /loadingTask\.onProgress/);
  assert.match(js, /pageStorageKey/);
  assert.match(js, /legacyPageStorageKey/);
  assert.match(js, /erase:path/);
  assert.match(js, /stroke:preview/);
  assert.match(js, /teacher:follow:state/);
  assert.match(js, /teacher:page/);
  assert.match(js, /forcedByTeacher/);
});

test("server protects the PDF role gate, versioned cache and health route", () => {
  const js = read("server.js");
  assert.match(js, /TEACHER_ONLY/);
  assert.match(js, /Cache-Control", "public, max-age=31536000, immutable"/);
  assert.match(js, /Accept-Ranges", "bytes"/);
  assert.match(js, /Content-Range/);
  assert.match(js, /status\(206\)/);
  assert.match(js, /status\(416\)/);
  assert.match(js, /app\.get\("\/health"/);
  assert.match(js, /db = client\.db\(MONGODB_DB_NAME\)/);
  assert.match(js, /teacher:follow:start/);
  assert.match(js, /teacher:follow:stop/);
  assert.match(js, /teacher:page/);
});

test("teacher follow button stays clickable and reports failures instead of remaining disabled", () => {
  const js = read("public/app.js");
  assert.match(js, /followBtn\.disabled = false/);
  assert.match(js, /teacher:follow:start/);
  assert.match(js, /teacher:follow:stop/);
  assert.match(js, /Не удалось связать страницы/);
});

test("live drawing uses throttled preview chunks", () => {
  const js = read("public/app.js");
  assert.match(js, /PREVIEW_INTERVAL_MS/);
  assert.match(js, /buildPreviewChunk/);
  assert.match(js, /mergePreviewStroke/);
  assert.match(js, /scheduleStrokePreview/);
  assert.match(js, /flushStrokePreview/);
});

test("live performance metrics cover RTT page render and remote stroke latency", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const dashboard = read("public/performance.html");

  assert.match(dashboard, /id="rttAvg"/);
  assert.match(dashboard, /id="pageAvg"/);
  assert.match(dashboard, /id="strokeAvg"/);
  assert.match(client, /perf:ping/);
  assert.match(client, /perf:preview:seen/);
  assert.match(client, /perfMetrics\.rtt/);
  assert.match(client, /perfMetrics\.page/);
  assert.match(client, /perfMetrics\.stroke/);
  assert.match(client, /renderStarted = performance\.now\(\)/);
  assert.match(server, /socket\.on\("perf:ping"/);
  assert.match(server, /socket\.on\("perf:preview:seen"/);
  assert.match(server, /perfOriginId/);
});

test("performance logging is isolated from the lesson and persisted separately", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const dashboard = read("public/performance.html");

  assert.match(client, /setInterval\(sendPerformanceLog, 20000\)/);
  assert.match(client, /fetch\("\/api\/performance"/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /Diagnostics must never disturb the lesson/);
  assert.match(server, /performance_logs/);
  assert.match(server, /app\.post\("\/api\/performance"/);
  assert.match(server, /app\.get\("\/api\/performance"/);
  assert.match(server, /expireAfterSeconds: 30 \* 24 \* 60 \* 60/);
  assert.match(server, /app\.get\("\/performance"/);
  assert.match(dashboard, /Последние замеры/);
  assert.match(dashboard, /Штрих round-trip/);
});

test("lesson pages hide owner performance navigation and inline metrics", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  assert.doesNotMatch(teacher, /id="perfStats"/);
  assert.doesNotMatch(student, /id="perfStats"/);
  assert.doesNotMatch(teacher, /id="perfLogButton"/);
  assert.doesNotMatch(student, /id="perfLogButton"/);
});

test("teacher keyboard text annotations can be selected, saved, synced and erased", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const teacher = read("public/teacher.html");

  assert.match(teacher, /id="textBtn"/);
  assert.match(client, /openTextEditor/);
  assert.match(client, /syncTextEditorGeometry/);
  assert.match(client, /textSizeSelect/);
  assert.match(client, /textFontSize/);
  assert.match(client, /editor\.style\.fontSize/);
  assert.match(client, /fontScale/);
  assert.match(client, /drawCanvas\.getBoundingClientRect\(\)\.width/);
  assert.match(client, /tool === "text"[\s\S]*textAtPoint\(point\)[\s\S]*openTextEditor\(point\)/);
  assert.match(client, /activeTextMove/);
  assert.match(client, /remainingWidthPx/);
  assert.match(client, /const leftPx = clickX/);
  assert.match(client, /socket\.emit\("text:commit", \{ \.\.\.item, documentId: currentDocumentId \}\)/);
  assert.doesNotMatch(client, /activeTextBox/);
  assert.match(client, /text:commit/);
  assert.match(client, /text:committed/);
  assert.match(client, /drawTextAnnotation/);
  assert.match(client, /erasePathHitsTextBox/);
  assert.match(client, /Ctrl|ctrlKey|metaKey/);
  assert.match(server, /isValidTextAnnotation/);
  assert.match(server, /socket\.on\("text:commit"/);
  assert.match(server, /type: "text"/);
  assert.match(server, /fontScale/);
  assert.match(server, /erasePathHitsBox/);
});

test("desktop swaps Hand for precision shape tools while touch layouts keep them hidden", () => {
  const css = read("public/styles.css");
  const client = read("public/app.js");
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  for (const html of [teacher, student]) {
    for (const id of ["lineBtn", "arrowBtn", "circleBtn", "ovalBtn"]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
      assert.match(html, new RegExp(`id=["']${id}["'][^>]*desktop-shape-tool`));
    }
  }

  assert.match(css, /\.desktop-shape-group[\s\S]*\.desktop-shape-tool\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /#handBtn\s*\{\s*display:\s*none/);
  assert.match(css, /\.desktop-shape-group\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(css, /\.desktop-shape-tool\s*\{[\s\S]*display:\s*inline-grid/);
  assert.match(css, /#zoomResetBtn\s*\{[\s\S]*width:\s*70px/);

  assert.match(client, /shapeToolActive/);
  assert.match(client, /buildShapeStroke/);
  assert.match(client, /\["line", "arrow", "circle", "oval"\]/);
  assert.match(client, /activeShape/);
  assert.match(client, /socket\.emit\("stroke:commit", \{ \.\.\.finished, documentId: currentDocumentId \}\)/);
});

test("desktop toolbar keeps compact grouped shapes and stable zoom width", () => {
  const css = read("public/styles.css");
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  assert.match(teacher, /class="desktop-shape-group"/);
  assert.match(student, /class="desktop-shape-group"/);
  assert.match(css, /width:\s*min\(1280px, calc\(100vw - 24px\)\)/);
  assert.match(css, /flex-wrap:\s*wrap/);
  assert.match(css, /\.zoom-controls\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(css, /\.desktop-shape-tool\s*\{[\s\S]*width:\s*44px/);
});

test("pen and eraser use compact accessible icons", () => {
  const css = read("public/styles.css");
  for (const page of ["public/teacher.html", "public/student.html"]) {
    const html = read(page);
    assert.match(html, /id="penBtn"[^>]*tool-icon-btn[^>]*aria-label="Ручка"/);
    assert.match(html, /id="eraserBtn"[^>]*tool-icon-btn[^>]*aria-label="Ластик"/);
    assert.match(html, /class="tool-icon"/);
  }
  assert.match(css, /\.tool-icon-btn\s*\{[\s\S]*width:\s*44px/);
  assert.match(css, /\.tool-icon\s*\{[\s\S]*stroke:\s*currentColor/);
});

test("homepage presents distinct actions and only real product capabilities", () => {
  const home = read("public/index.html");
  const css = read("public/home.css");

  assert.match(home, /href="#features">Посмотреть возможности/);
  assert.match(home, /href="#login">Войти в кабинет/);
  assert.doesNotMatch(home, /Начать <span>→<\/span><\/a>\s*<a class="secondary-cta" href="#login">Войти/);
  assert.doesNotMatch(home, /Прогресс и мотивация/);
  assert.doesNotMatch(home, /Учебники, PDF и задания/);
  assert.doesNotMatch(home, /user-scalable=no/);
  assert.match(home, /id="how"/);
  assert.match(home, /loading="lazy"/);
  assert.match(home, /width="1448" height="1086"/);
  assert.doesNotMatch(home, /social-dots/);
  assert.match(css, /\.how-card/);
  assert.match(css, /\.hero-stage::after/);
});

test("tablet PDF view prioritizes document space in portrait and landscape", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  const css = read("public/pdf-view.css");
  const app = read("public/app.js");

  assert.match(teacher, /class="pdf-view-page"/);
  assert.match(student, /class="pdf-view-page"/);
  assert.match(teacher, /\/pdf-view\.css\?v=/);
  assert.match(student, /\/pdf-view\.css\?v=/);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /orientation:portrait/);
  assert.match(css, /#stage\{[^}]*max-height:calc\(100vh - 122px\)/);
  assert.match(css, /\.toolbar\{[^}]*flex-wrap:nowrap/);
  assert.match(css, /#firstBtn,\s*\.pdf-view-page #lastBtn\{\s*display:none/);
  assert.doesNotMatch(app, /Math\.min\(window\.innerWidth - 20, 1100\)/);
  assert.match(app, /stageWidth/);
  assert.match(app, /isTabletLandscape/);
  assert.match(app, /Math\.min\(widthScale, heightScale\)/);
});

test("teacher dashboard hero matches the mock without scalloped pseudo decorations", () => {
  const html = read("public/dashboard.html");
  const css = read("public/dashboard.css");

  assert.match(html, /class="teacher-hero"/);
  assert.match(html, /class="teacher-hero-art"/);
  assert.match(css, /\.teacher-hero\{[^}]*overflow:hidden[^}]*border-radius:34px/);
  assert.match(css, /\.teacher-hero-art\{[^}]*object-fit:contain/);
  assert.doesNotMatch(css, /\.teacher-hero::after/);
  assert.doesNotMatch(css, /\.teacher-hero::before/);
  assert.doesNotMatch(css, /radial-gradient\([^\n]*#fff 98%/);
});

test("teacher sessions archive separately and legacy default lesson is removed", () => {
  const server = read("server.js");
  const dashboard = read("public/dashboard.html");
  const cabinet = read("public/cabinet.js");

  assert.match(server, /req\.query\.archive === "1"/);
  assert.match(server, /app\.post\("\/api\/teacher\/lessons\/:id\/archive"/);
  assert.match(server, /status: "archived"/);
  assert.match(server, /\$unset: \{ inviteToken: "" \}/);
  assert.match(server, /app\.delete\("\/api\/teacher\/lessons\/:id"/);
  assert.match(server, /lastParticipantName: name/);
  assert.match(server, /lastParticipantAt: joinedAt/);
  assert.match(server, /await lessons\.deleteOne\(\{ _id: "default" \}\)/);
  assert.doesNotMatch(server, /await lessons\.updateOne\(\s*\{ _id: "default" \}/);

  assert.match(dashboard, /data-teacher-view="active"/);
  assert.match(dashboard, /data-teacher-view="archive"/);
  assert.match(cabinet, /teacherView === "archive"/);
  assert.match(cabinet, /Завершить/);
  assert.match(cabinet, /Удалить навсегда/);
  assert.match(cabinet, /Ученик:/);
});

test("teacher material library can attach PDFs and collect homework submissions", () => {
  const server = read("server.js");
  const dashboard = read("public/dashboard.html");
  const cabinet = read("public/cabinet.js");
  const student = read("public/student.html");
  const studentSession = read("public/student-session.js");

  assert.match(server, /materials = db\.collection\(collectionName\("materials"\)\)/);
  assert.match(server, /homeworkSubmissions = db\.collection\(collectionName\("homework_submissions"\)\)/);
  assert.match(server, /app\.get\("\/api\/materials"/);
  assert.match(server, /app\.post\("\/api\/materials"/);
  assert.match(server, /app\.patch\("\/api\/teacher\/lessons\/:id\/material"/);
  assert.match(server, /ownerId: req\.user\._id/);
  assert.match(server, /MATERIAL_IN_USE/);
  assert.match(server, /materialId: material\._id/);
  assert.match(server, /app\.post\("\/api\/homework\/submit"/);
  assert.match(server, /req\.lesson\.type !== "homework"/);
  assert.match(server, /app\.get\("\/api\/teacher\/lessons\/:id\/submissions"/);

  assert.match(dashboard, /id="materialPanel"/);
  assert.match(dashboard, /id="materialUploadForm"/);
  assert.match(cabinet, /\/api\/materials/);
  assert.match(cabinet, /Прикрепить PDF/);
  assert.match(cabinet, /Сдано:/);
  assert.match(student, /id="submitHomeworkBtn"/);
  assert.match(studentSession, /lesson\.type !== "homework"/);
  assert.match(studentSession, /\/api\/homework\/submit\?lesson=/);
});

test("teacher invite sessions let children join without accounts", () => {
  const server = read("server.js");
  const auth = read("lib/auth.js");
  const cabinet = read("public/cabinet.js");
  const dashboard = read("public/dashboard.html");
  const join = read("public/join.html");
  const joinJs = read("public/join.js");
  const student = read("public/student.html");
  const home = read("public/index.html");

  assert.match(server, /app\.post\("\/api\/auth\/register"/);
  assert.match(server, /app\.post\("\/api\/teacher\/lessons"/);
  assert.match(server, /app\.get\("\/api\/join\/:token"/);
  assert.match(server, /app\.post\("\/api\/join\/:token"/);
  assert.match(server, /inviteToken: newInviteToken\(\)/);
  assert.match(server, /ownerId: req\.user\._id/);
  assert.match(server, /user\.guest/);
  assert.match(server, /user\.lessonId === lessonId/);

  assert.match(auth, /GUEST_COOKIE/);
  assert.match(auth, /createGuestToken/);
  assert.match(auth, /parseGuestToken/);
  assert.match(auth, /GUEST_TTL_SECONDS/);

  assert.match(dashboard, /id="createTeacherSessionForm"/);
  assert.match(cabinet, /\/api\/teacher\/lessons/);
  assert.match(cabinet, /Скопировать ссылку/);
  assert.match(join, /Как тебя зовут/);
  assert.match(joinJs, /\/api\/join\//);
  assert.doesNotMatch(student, /href="\/cabinet"/);
  assert.match(home, /href="\/register">Создать кабинет учителя/);
});

test("root is login and cabinet preserves account-aware lesson navigation", () => {
  const login = read("public/index.html");
  const cabinet = read("public/dashboard.html");
  const cabinetJs = read("public/cabinet.js");
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  const server = read("server.js");

  assert.match(login, /id="loginForm"/);
  assert.match(login, /id="username"/);
  assert.match(login, /id="password"/);
  assert.match(cabinet, /id="logoutBtn"/);
  assert.doesNotMatch(cabinet, /role-teacher/);
  assert.doesNotMatch(cabinet, /role-student/);
  assert.match(cabinetJs, /Открыть урок/);
  assert.match(cabinetJs, /Как учитель/);
  assert.match(cabinetJs, /Как ученик/);
  assert.match(teacher, /href="\/cabinet"/);
  assert.doesNotMatch(student, /href="\/cabinet"/);
  assert.match(server, /app\.post\("\/api\/auth\/login"/);
  assert.match(server, /app\.get\("\/api\/auth\/me"/);
  assert.match(server, /requirePageAuth/);
  assert.match(server, /requireApiRole/);
  assert.match(server, /io\.use\(async \(socket, next\)/);
  assert.match(server, /username: "admin"/);
  assert.match(server, /username: "Darya"/);
  assert.match(server, /username: "Alisa"/);
  assert.doesNotMatch(server, /Parole\.123!/);
  assert.doesNotMatch(server, /12345678/);
  assert.match(server, /db\.collection\("users"\)/);
  assert.match(server, /db\.collection\("lessons"\)/);
});


test("teacher and student can download the current PDF", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  const client = read("public/app.js");
  const server = read("server.js");

  assert.match(teacher, /id="downloadPdfBtn"/);
  assert.match(student, /id="downloadPdfBtn"/);
  assert.match(client, /downloadPdfBtn\.href/);
  assert.match(client, /download=1/);
  assert.match(server, /req\.query\.download === "1" \? "attachment" : "inline"/);
  assert.match(server, /filename\*=UTF-8/);
});


test("lesson realtime and data are scoped by lessonId", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const cabinet = read("public/cabinet.js");

  assert.match(client, /const lessonId = new URLSearchParams\(location\.search\)\.get\("lesson"\) \|\| "default"/);
  assert.match(client, /io\(\{ auth: \{ role, lessonId \} \}\)/);
  assert.match(client, /\/api\/document\?lesson=\$\{lessonParam\}/);
  assert.match(client, /\/api\/annotations\/\$\{pageNumber\}\?lesson=\$\{lessonParam\}/);

  assert.match(server, /function requireLessonAccess/);
  assert.match(server, /function lessonRoom/);
  assert.match(server, /socket\.join\(room\)/);
  assert.match(server, /socket\.to\(room\)\.emit\("stroke:preview"/);
  assert.match(server, /io\.to\(room\)\.emit\("teacher:follow:state"/);
  assert.match(server, /lessonId,/);
  assert.match(server, /documentId:/);
  assert.match(server, /annotationLessonFilter/);
  assert.match(server, /app\.get\("\/api\/lessons"/);

  assert.match(cabinet, /fetch\("\/api\/lessons"/);
  assert.match(cabinet, /lessonUrl/);
  assert.match(cabinet, /encodeURIComponent\(lessonId\)/);
});

test("lesson access is derived from persisted lesson membership", () => {
  const server = read("server.js");
  assert.match(server, /lesson\.teacherIds\?\.includes\(user\._id\)/);
  assert.match(server, /lesson\.studentIds\?\.includes\(user\._id\)/);
  assert.match(server, /LESSON_FORBIDDEN/);
});


test("mobile text editor focuses during the tap instead of a deferred frame", () => {
  const client = read("public/app.js");
  assert.match(client, /tool === "text"[\s\S]*event\.preventDefault\(\)/);
  assert.match(client, /editor\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(client, /requestAnimationFrame\(\(\) => editor\.focus\(\)\)/);
});

test("annotations are scoped to the current document inside each lesson", () => {
  const server = read("server.js");
  assert.match(server, /function annotationDocumentFilter/);
  assert.match(server, /currentDocumentIdForLesson/);
  assert.match(server, /DOCUMENT_MISMATCH/);
  assert.match(server, /annotationDocumentFilter\(req\.lessonId, documentId\)/);
  assert.match(server, /annotationDocumentFilter\(lessonId, documentId\)/);
  assert.match(server, /existing\.documentId === documentId/);
});


test("admin can manage users and lessons from the cabinet", () => {
  const dashboard = read("public/dashboard.html");
  const cabinet = read("public/cabinet.js");
  const server = read("server.js");

  assert.match(dashboard, /id="adminPanel"/);
  assert.match(dashboard, /id="createUserForm"/);
  assert.match(dashboard, /id="createLessonForm"/);
  assert.doesNotMatch(dashboard, /id="newLessonId"/);
  assert.doesNotMatch(dashboard, />ID урока</);
  assert.match(dashboard, /id="adminUserList"/);
  assert.match(dashboard, /id="adminLessonList"/);

  assert.match(cabinet, /\/api\/admin\/users/);
  assert.match(cabinet, /\/api\/admin\/lessons/);
  assert.match(cabinet, /method: "PATCH"/);
  assert.match(cabinet, /Деактивировать/);

  assert.match(server, /app\.get\("\/api\/admin\/users"/);
  assert.match(server, /app\.post\("\/api\/admin\/users"/);
  assert.match(server, /app\.patch\("\/api\/admin\/users\/:id"/);
  assert.match(server, /app\.get\("\/api\/admin\/lessons"/);
  assert.match(server, /app\.post\("\/api\/admin\/lessons"/);
  assert.match(server, /app\.patch\("\/api\/admin\/lessons\/:id"/);
  assert.match(server, /await hashPassword\(password\)/);
  assert.match(server, /validateLessonMembers/);
  assert.match(server, /crypto\.randomUUID\(\)/);
});

test("login sends every role through the cabinet instead of hardcoding default lesson", () => {
  const server = read("server.js");
  assert.match(server, /function homeForRole\(_role\) \{\s*return "\/cabinet";\s*\}/);
  assert.doesNotMatch(server, /return "\/teacher\?lesson=default"/);
  assert.doesNotMatch(server, /return "\/student\?lesson=default"/);
});

test("admin management UI is responsive", () => {
  const css = read("public/landing.css");
  assert.match(css, /\.admin-panel/);
  assert.match(css, /\.admin-grid/);
  assert.match(css, /\.admin-member-grid/);
  assert.match(css, /@media \(max-width: 720px\)/);
});


test("cabinet opens concrete lessons and admin gets a read-only control action", () => {
  const dashboard = read("public/dashboard.html");
  const cabinet = read("public/cabinet.js");
  const monitor = read("public/monitor.html");
  const server = read("server.js");

  assert.doesNotMatch(dashboard, /role-grid/);
  assert.match(cabinet, /Открыть урок/);
  assert.match(cabinet, /Как учитель/);
  assert.match(cabinet, /Как ученик/);
  assert.match(cabinet, /Контроль/);
  assert.match(cabinet, /\/monitor\?lesson=/);

  assert.match(monitor, /data-role="observer"/);
  assert.match(monitor, /Только просмотр/);
  assert.doesNotMatch(monitor, /pdfUpload/);
  assert.doesNotMatch(monitor, /textBtn/);

  assert.match(server, /app\.get\("\/monitor"/);
  assert.match(server, /role === "observer"/);
  assert.match(server, /READ_ONLY/);
});


test("control mode shows the teacher's live lesson page without taking write control", () => {
  const monitor = read("public/monitor.html");
  const client = read("public/app.js");
  const server = read("server.js");

  assert.match(monitor, /id="observerTeacherPage"/);
  assert.match(monitor, /Урок сейчас: стр/);
  assert.match(client, /teacher:monitor:page/);
  assert.match(client, /observerTeacherPage\.textContent/);
  assert.match(client, /role === "teacher"[\s\S]*teacher:monitor:page/);
  assert.match(server, /teacherPageByLesson/);
  assert.match(server, /socket\.on\("teacher:monitor:page"/);
  assert.match(server, /socket\.to\(room\)\.emit\("teacher:monitor:page"/);
});


test("preview data can be isolated by collection namespace without changing production defaults", () => {
  const server = read("server.js");

  assert.match(server, /const DATA_NAMESPACE = String\(process\.env\.DATA_NAMESPACE/);
  assert.match(server, /const collectionName = \(base\) => DATA_NAMESPACE/);
  assert.match(server, /const GRIDFS_BUCKET_NAME = collectionName\("pdfs"\)/);
  assert.match(server, /db\.collection\(collectionName\("users"\)\)/);
  assert.match(server, /db\.collection\(collectionName\("lessons"\)\)/);
  assert.match(server, /db\.collection\(collectionName\("annotations"\)\)/);
  assert.match(server, /db\.collection\(collectionName\("settings"\)\)/);
  assert.match(server, /db\.collection\(collectionName\("performance_logs"\)\)/);
  assert.match(server, /new GridFSBucket\(db, \{ bucketName: GRIDFS_BUCKET_NAME \}\)/);
  assert.match(server, /Bootstrapped namespace/);
});


test("MongoDB database name is configurable per environment", () => {
  const server = read("server.js");

  assert.match(server, /const MONGODB_DB_NAME = String\(process\.env\.MONGODB_DB_NAME \|\| "school_app"\)\.trim\(\)/);
  assert.match(server, /db = client\.db\(MONGODB_DB_NAME\)/);
});
