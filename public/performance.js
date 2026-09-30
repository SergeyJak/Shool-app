const hoursFilter = document.getElementById("hoursFilter");
const roleFilter = document.getElementById("roleFilter");
const refreshBtn = document.getElementById("refreshBtn");
const logRows = document.getElementById("logRows");
const emptyLogs = document.getElementById("emptyLogs");
const updatedAt = document.getElementById("updatedAt");

const metricEls = {
  rttAvg: document.getElementById("rttAvg"),
  rttP95: document.getElementById("rttP95"),
  pageAvg: document.getElementById("pageAvg"),
  pageP95: document.getElementById("pageP95"),
  strokeAvg: document.getElementById("strokeAvg"),
  strokeP95: document.getElementById("strokeP95"),
  sessionCount: document.getElementById("sessionCount"),
  sampleCount: document.getElementById("sampleCount"),
};

function ms(value) {
  return Number.isFinite(value) ? `${Math.round(value)}мс` : "—";
}

function dateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadPerformance() {
  refreshBtn.disabled = true;
  try {
    const params = new URLSearchParams({
      hours: hoursFilter.value,
      limit: "500",
    });
    if (roleFilter.value) params.set("role", roleFilter.value);

    const res = await fetch(`/api/performance?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`PERF_${res.status}`);

    const payload = await res.json();
    const summary = payload.summary || {};

    metricEls.rttAvg.textContent = ms(summary.rtt?.avg);
    metricEls.rttP95.textContent = `p95 ${ms(summary.rtt?.p95)}`;
    metricEls.pageAvg.textContent = ms(summary.page?.avg);
    metricEls.pageP95.textContent = `p95 ${ms(summary.page?.p95)}`;
    metricEls.strokeAvg.textContent = ms(summary.stroke?.avg);
    metricEls.strokeP95.textContent = `p95 ${ms(summary.stroke?.p95)}`;
    metricEls.sessionCount.textContent = String(summary.sessions ?? 0);
    metricEls.sampleCount.textContent = `${summary.samples ?? 0} замеров`;

    const rows = payload.rows || [];
    emptyLogs.hidden = rows.length > 0;
    logRows.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(dateTime(row.createdAt))}</td>
        <td><span class="role-pill">${row.role === "teacher" ? "Учитель" : "Ученик"}</span></td>
        <td class="num">${escapeHtml(ms(row.rtt))}</td>
        <td class="num">${escapeHtml(ms(row.pageMs))}</td>
        <td class="num">${escapeHtml(ms(row.strokeMs))}</td>
        <td class="num">${escapeHtml(row.page ?? "—")}</td>
        <td>${escapeHtml(row.network || "—")}</td>
      </tr>
    `).join("");

    updatedAt.textContent = `Обновлено: ${new Date().toLocaleTimeString("ru-RU")}`;
  } catch (error) {
    console.error(error);
    updatedAt.textContent = "Не удалось загрузить метрики";
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadPerformance);
hoursFilter.addEventListener("change", loadPerformance);
roleFilter.addEventListener("change", loadPerformance);

loadPerformance();
setInterval(loadPerformance, 30000);
