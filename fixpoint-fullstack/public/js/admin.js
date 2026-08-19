const Admin = (() => {
  let map, markersLayer, pollTimer;
  let complaintsCache = [], workersCache = [];
  let activeThreadUserId = null;

  function init() {
    const center = (App.user.district && DISTRICT_COORDS[App.user.district]) || TN_CENTER;
    const zoom = App.user.district ? 11 : 7;
    map = L.map("admin-map").setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    document.getElementById("admin-chat-form").addEventListener("submit", handleChatSend);
  }

  async function loadAll() {
    try {
      const [c, w] = await Promise.all([
        api("GET", "/api/admin/complaints"),
        api("GET", "/api/admin/workers")
      ]);
      complaintsCache = c.complaints;
      workersCache = w.workers;
      renderReview();
      renderApprovals();
      renderTracking();
      renderCompleted();
      renderOverview();
      renderThreads();
    } catch (err) { toast(err.message, true); }
  }

  function actionTicket(c, extraButtonsHtml) {
    const photo = c.photoUrl ? `<img src="${c.photoUrl}" class="ticket-thumb" alt="" />` : "";
    return `<div class="ticket ticket-wide">
      ${photo}
      <div class="ticket-main">
        <div class="ticket-cat">${escapeHtml(c.category)}</div>
        <div class="ticket-desc">${escapeHtml(c.description)}</div>
        <div class="ticket-meta"><span class="ticket-id">${c.id}</span> · ${escapeHtml(c.district || "")} · ${escapeHtml(c.citizenName)} · filed ${timeAgo(c.createdAt)}${c.address ? " · " + escapeHtml(c.address) : ""}</div>
        ${c.workerName ? `<div class="ticket-meta">Worker: ${escapeHtml(c.workerName)}${c.scheduledAt ? " · scheduled " + new Date(c.scheduledAt).toLocaleString() : ""}</div>` : ""}
        ${extraButtonsHtml || ""}
      </div>
      <span class="stamp ${statusStampClass(c.status)}">${c.status}</span>
    </div>`;
  }

  function renderReview() {
    const list = complaintsCache.filter(c => c.status === "Submitted");
    const el = document.getElementById("admin-review-list");
    el.innerHTML = list.length ? list.map(c => actionTicket(c, `
      <div class="row-actions">
        <button class="btn btn-outline btn-sm" data-approve="${c.id}">Approve</button>
        <button class="btn btn-outline btn-sm btn-danger" data-reject="${c.id}">Reject</button>
      </div>`)).join("") : `<div class="ticket-empty">Nothing waiting for review.</div>`;

    el.querySelectorAll("[data-approve]").forEach(btn => btn.addEventListener("click", async () => {
      try { await api("POST", `/api/admin/complaints/${btn.dataset.approve}/approve`); toast("Approved."); loadAll(); }
      catch (err) { toast(err.message, true); }
    }));
    el.querySelectorAll("[data-reject]").forEach(btn => btn.addEventListener("click", async () => {
      const reason = prompt("Reason for rejecting this report?") || "";
      try { await api("POST", `/api/admin/complaints/${btn.dataset.reject}/reject`, { reason }); toast("Rejected."); loadAll(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  function renderApprovals() {
    const pending = complaintsCache.filter(c => c.status === "Submitted");
    const approved = complaintsCache.filter(c => c.status === "Approved");

    document.getElementById("admin-pending-list").innerHTML = pending.length
      ? pending.map(c => actionTicket(c)).join("")
      : `<div class="ticket-empty">Nothing pending.</div>`;

    const el = document.getElementById("admin-approved-list");
    if (!approved.length) { el.innerHTML = `<div class="ticket-empty">No approved reports waiting on a worker.</div>`; return; }
    el.innerHTML = approved.map(c => {
      const matching = workersCache.filter(w => w.category === c.category && w.district === c.district);
      const options = matching.length
        ? matching.map(w => `<option value="${w.id}">${escapeHtml(w.name)} — ${escapeHtml(w.district)} (${w.activeJobs} active, ${starDisplay(w.ratingAvg)})</option>`).join("")
        : `<option value="" disabled>No workers enrolled for ${escapeHtml(c.category)} in ${escapeHtml(c.district)} yet</option>`;
      return actionTicket(c, `
        <div class="row-actions">
          <select class="assign-select" data-assign-select="${c.id}">${options}</select>
          <button class="btn btn-amber btn-sm" data-assign-btn="${c.id}" ${matching.length ? "" : "disabled"}>Assign</button>
        </div>`);
    }).join("");

    el.querySelectorAll("[data-assign-btn]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.assignBtn;
      const workerId = el.querySelector(`[data-assign-select="${id}"]`).value;
      try { await api("POST", `/api/admin/complaints/${id}/assign`, { workerId }); toast("Assigned to worker."); loadAll(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  function renderTracking() {
    const inProgress = complaintsCache.filter(c => ["Assigned", "Scheduled", "In Progress"].includes(c.status));
    document.getElementById("admin-tracking-list").innerHTML = inProgress.length
      ? inProgress.map(c => actionTicket(c)).join("")
      : `<div class="ticket-empty">No jobs currently in the pipeline.</div>`;

    const grid = document.getElementById("admin-workers-list");
    grid.innerHTML = workersCache.map(w => `
      <div class="worker-card">
        <div class="worker-name">${escapeHtml(w.name)}</div>
        <div class="worker-cat">${escapeHtml(w.category)} · ${escapeHtml(w.district)}</div>
        <div class="worker-rating">${starDisplay(w.ratingAvg)} <span class="worker-rating-count">(${w.ratingCount})</span></div>
        <div class="worker-active">${w.activeJobs} active job${w.activeJobs === 1 ? "" : "s"}</div>
      </div>`).join("");
  }

  function renderCompleted() {
    const done = complaintsCache.filter(c => ["Completed", "Closed"].includes(c.status));
    const el = document.getElementById("admin-completed-list");
    if (!done.length) { el.innerHTML = `<div class="ticket-empty">Nothing completed yet.</div>`; return; }
    el.innerHTML = done.map(c => {
      const fb = c.feedbackRating ? `<div class="ticket-meta">Citizen feedback: ${"★".repeat(c.feedbackRating)}${c.feedbackComment ? " — " + escapeHtml(c.feedbackComment) : ""}</div>` : `<div class="ticket-meta">Awaiting citizen feedback.</div>`;
      const rateBlock = c.workerRating
        ? `<div class="ticket-meta">Worker rated: ${"★".repeat(c.workerRating)}</div>`
        : `<div class="row-actions">
            <select class="rate-select" data-rate-select="${c.id}">
              <option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option>
            </select>
            <button class="btn btn-outline btn-sm" data-rate-btn="${c.id}">Rate worker</button>
          </div>`;
      return actionTicket(c, fb + rateBlock);
    }).join("");

    el.querySelectorAll("[data-rate-btn]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.rateBtn;
      const rating = el.querySelector(`[data-rate-select="${id}"]`).value;
      try { await api("POST", `/api/admin/complaints/${id}/rate-worker`, { rating: Number(rating) }); toast("Worker rated."); loadAll(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  function renderOverview() {
    api("GET", "/api/admin/stats").then(({ total, byStatus, byCategory }) => {
      renderBars("bars-status", byStatus, total);
      renderBars("bars-category", byCategory, total);
    }).catch(() => {});

    markersLayer.clearLayers();
    const pts = [];
    complaintsCache.forEach(c => {
      if (c.lat == null) return;
      L.circleMarker([c.lat, c.lng], { radius: 7, color: statusMarkerColor(c.status), fillColor: statusMarkerColor(c.status), fillOpacity: 0.85, weight: 2 })
        .bindPopup(`<strong>${escapeHtml(c.category)}</strong><br/>${c.id}<br/>${escapeHtml(c.status)}`)
        .addTo(markersLayer);
      pts.push([c.lat, c.lng]);
    });
    if (pts.length) map.fitBounds(pts, { maxZoom: 13, padding: [20, 20] });
  }

  function renderBars(containerId, counts, total) {
    const el = document.getElementById(containerId);
    const entries = Object.entries(counts || {});
    if (!entries.length) { el.innerHTML = `<div class="ticket-empty">No data yet.</div>`; return; }
    el.innerHTML = entries.map(([label, count]) => {
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `<div class="bar-row"><span>${escapeHtml(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-count">${count}</span></div>`;
    }).join("");
  }

  async function renderThreads() {
    try {
      const { threads } = await api("GET", "/api/messages/threads");
      const el = document.getElementById("admin-thread-list");
      el.innerHTML = threads.length ? threads.map(t => `
        <button class="thread-item ${t.userId === activeThreadUserId ? "active" : ""}" data-thread="${t.userId}" data-name="${escapeHtml(t.name)}">
          <span class="thread-name">${escapeHtml(t.name)} <span class="thread-role">(${t.role})</span></span>
          <span class="thread-last">${escapeHtml((t.lastMessage || "").slice(0, 50))}</span>
          ${t.unread ? `<span class="thread-unread">${t.unread}</span>` : ""}
        </button>`).join("") : `<div class="ticket-empty">No conversations yet.</div>`;
      el.querySelectorAll("[data-thread]").forEach(btn => btn.addEventListener("click", () => openThread(btn.dataset.thread, btn.dataset.name)));
    } catch (err) { /* silent */ }
  }

  async function openThread(userId, name) {
    activeThreadUserId = userId;
    document.getElementById("admin-chat-title").textContent = name;
    document.getElementById("admin-chat-form").hidden = false;
    renderThreads();
    await refreshChat();
  }

  async function refreshChat() {
    if (!activeThreadUserId) return;
    try {
      const { messages } = await api("GET", `/api/messages/thread/${activeThreadUserId}`);
      const log = document.getElementById("admin-chat-log");
      log.innerHTML = messages.length
        ? messages.map(m => `<div class="chat-msg ${m.from_role === "admin" ? "chat-msg-me" : "chat-msg-them"}">
            <span class="chat-msg-role">${m.from_role === "admin" ? "You" : m.from_role}</span>
            <span class="chat-msg-text">${escapeHtml(m.text)}</span>
            <span class="chat-msg-time">${timeAgo(m.at)}</span>
          </div>`).join("")
        : `<div class="ticket-empty">No messages yet.</div>`;
      log.scrollTop = log.scrollHeight;
    } catch (err) { /* silent */ }
  }

  async function handleChatSend(e) {
    e.preventDefault();
    if (!activeThreadUserId) { toast("Pick a conversation first.", true); return; }
    const input = document.getElementById("admin-chat-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api("POST", "/api/messages", { text, threadUserId: activeThreadUserId });
      input.value = "";
      refreshChat();
      renderThreads();
    } catch (err) { toast(err.message, true); }
  }

  function onShow() {
    loadAll();
    setTimeout(() => map.invalidateSize(), 50);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { loadAll(); refreshChat(); }, 6000);
  }
  function onHide() { clearInterval(pollTimer); }

  return { init, onShow, onHide };
})();
