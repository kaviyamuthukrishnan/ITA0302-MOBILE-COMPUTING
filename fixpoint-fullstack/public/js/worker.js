const Worker = (() => {
  let pollTimer, chatPollTimer;
  let soundEnabled = false;
  let audioCtx = null, buzzerNodes = null;
  let pendingScheduleId = null;
  let seenNotificationIds = new Set();

  function init() {
    document.getElementById("enable-sound-btn").addEventListener("click", enableSound);
    document.getElementById("alarm-accept-btn").addEventListener("click", () => {
      const id = document.getElementById("alarm-overlay").dataset.complaintId;
      closeAlarm();
      openScheduleModal(id);
    });
    document.getElementById("alarm-dismiss-btn").addEventListener("click", closeAlarm);
    document.getElementById("schedule-cancel-btn").addEventListener("click", closeScheduleModal);
    document.getElementById("schedule-confirm-btn").addEventListener("click", confirmSchedule);
    document.getElementById("worker-chat-form").addEventListener("submit", handleChatSend);
  }

  function enableSound() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      soundEnabled = true;
      toast("Assignment alerts enabled.");
      document.getElementById("enable-sound-btn").textContent = "🔔 Alerts enabled";
      document.getElementById("enable-sound-btn").disabled = true;
    } catch (e) { toast("This browser doesn't support alert sound.", true); }
  }

  function startBuzzer() {
    if (!soundEnabled || !audioCtx) return;
    stopBuzzer();
    let on = true;
    function beep() {
      if (!on) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square"; osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.25);
    }
    beep();
    const interval = setInterval(beep, 600);
    buzzerNodes = { stop: () => { on = false; clearInterval(interval); } };
  }
  function stopBuzzer() { if (buzzerNodes) { buzzerNodes.stop(); buzzerNodes = null; } }

  function showAlarm(notification) {
    const overlay = document.getElementById("alarm-overlay");
    overlay.dataset.complaintId = notification.complaint_id;
    overlay.dataset.notificationId = notification.id;
    const c = notification.complaint;
    document.getElementById("alarm-details").innerHTML = c
      ? `<span class="mono">${c.id}</span> — ${escapeHtml(c.category)}<br/>${escapeHtml(c.description).slice(0, 90)}`
      : "";
    overlay.hidden = false;
    startBuzzer();
  }

  function closeAlarm() {
    const overlay = document.getElementById("alarm-overlay");
    const notifId = overlay.dataset.notificationId;
    overlay.hidden = true;
    stopBuzzer();
    if (notifId) api("POST", `/api/worker/notifications/${notifId}/seen`).catch(() => {});
  }

  function openScheduleModal(complaintId) {
    pendingScheduleId = complaintId;
    document.getElementById("schedule-datetime").value = "";
    document.getElementById("schedule-modal").hidden = false;
  }
  function closeScheduleModal() {
    document.getElementById("schedule-modal").hidden = true;
    pendingScheduleId = null;
  }
  async function confirmSchedule() {
    const dt = document.getElementById("schedule-datetime").value;
    if (!dt) { toast("Pick a date and time.", true); return; }
    try {
      await api("POST", `/api/worker/assignments/${pendingScheduleId}/accept`, { scheduledAt: dt });
      toast("Job accepted and scheduled.");
      closeScheduleModal();
      refreshAssignments();
    } catch (err) { toast(err.message, true); }
  }

  async function checkNotifications() {
    try {
      const { notifications } = await api("GET", "/api/worker/notifications/pending");
      const overlay = document.getElementById("alarm-overlay");
      if (notifications.length && overlay.hidden) {
        const next = notifications.find(n => !seenNotificationIds.has(n.id));
        if (next) { seenNotificationIds.add(next.id); showAlarm(next); }
      }
    } catch (err) { /* silent */ }
  }

  function ticketCard(c, extraHtml) {
    const photo = c.photoUrl ? `<img src="${c.photoUrl}" class="ticket-thumb" alt="" />` : "";
    return `<div class="ticket ticket-wide">
      ${photo}
      <div class="ticket-main">
        <div class="ticket-cat">${escapeHtml(c.category)}</div>
        <div class="ticket-desc">${escapeHtml(c.description)}</div>
        <div class="ticket-meta"><span class="ticket-id">${c.id}</span> · filed ${timeAgo(c.createdAt)}${c.address ? " · " + escapeHtml(c.address) : ""}</div>
        ${c.lat != null ? `<div class="ticket-meta"><a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">Get directions →</a></div>` : ""}
        ${c.scheduledAt ? `<div class="ticket-meta">Scheduled: ${new Date(c.scheduledAt).toLocaleString()}</div>` : ""}
        ${extraHtml || ""}
      </div>
      <span class="stamp ${statusStampClass(c.status)}">${c.status}</span>
    </div>`;
  }

  async function refreshAssignments() {
    try {
      const { complaints } = await api("GET", "/api/worker/assignments");
      const pending = complaints.filter(c => c.status === "Assigned");
      const active = complaints.filter(c => ["Scheduled", "In Progress"].includes(c.status));

      const pendEl = document.getElementById("worker-assignments-list");
      pendEl.innerHTML = pending.length ? pending.map(c => ticketCard(c, `
        <div class="row-actions"><button class="btn btn-amber btn-sm" data-accept="${c.id}">Accept &amp; schedule</button></div>
      `)).join("") : `<div class="ticket-empty">No new assignments right now.</div>`;
      pendEl.querySelectorAll("[data-accept]").forEach(btn => btn.addEventListener("click", () => openScheduleModal(btn.dataset.accept)));

      const actEl = document.getElementById("worker-active-list");
      actEl.innerHTML = active.length ? active.map(c => {
        const btn = c.status === "Scheduled"
          ? `<button class="btn btn-outline btn-sm" data-start="${c.id}">Start work</button>`
          : `<button class="btn btn-amber btn-sm" data-complete="${c.id}">Mark completed</button>`;
        return ticketCard(c, `<div class="row-actions">${btn}</div>`);
      }).join("") : `<div class="ticket-empty">Nothing scheduled yet.</div>`;
      actEl.querySelectorAll("[data-start]").forEach(btn => btn.addEventListener("click", () => updateStatus(btn.dataset.start, "In Progress")));
      actEl.querySelectorAll("[data-complete]").forEach(btn => btn.addEventListener("click", () => updateStatus(btn.dataset.complete, "Completed")));
    } catch (err) { toast(err.message, true); }
  }

  async function updateStatus(id, status) {
    try {
      await api("POST", `/api/worker/assignments/${id}/status`, { status });
      toast(status === "Completed" ? "Marked completed — awaiting citizen feedback." : "Marked in progress.");
      refreshAssignments();
    } catch (err) { toast(err.message, true); }
  }

  async function refreshChat() {
    try {
      const { messages } = await api("GET", `/api/messages/thread/${App.user.id}`);
      const log = document.getElementById("worker-chat-log");
      log.innerHTML = messages.length
        ? messages.map(m => `<div class="chat-msg ${m.from_role === "admin" ? "chat-msg-them" : "chat-msg-me"}">
            <span class="chat-msg-role">${m.from_role === "admin" ? "Department" : "You"}</span>
            <span class="chat-msg-text">${escapeHtml(m.text)}</span>
            <span class="chat-msg-time">${timeAgo(m.at)}</span>
          </div>`).join("")
        : `<div class="ticket-empty">No messages yet.</div>`;
      log.scrollTop = log.scrollHeight;
    } catch (err) { /* silent */ }
  }
  async function handleChatSend(e) {
    e.preventDefault();
    const input = document.getElementById("worker-chat-input");
    const text = input.value.trim();
    if (!text) return;
    try { await api("POST", "/api/messages", { text }); input.value = ""; refreshChat(); }
    catch (err) { toast(err.message, true); }
  }

  function renderProfile() {
    const u = App.user;
    document.getElementById("worker-profile-panel").innerHTML = `
      <h2 class="panel-title">My profile</h2>
      <div class="profile-grid">
        <div><span class="profile-label">Name</span><span class="profile-value">${escapeHtml(u.name)}</span></div>
        <div><span class="profile-label">Email</span><span class="profile-value">${escapeHtml(u.email)}</span></div>
        <div><span class="profile-label">Category</span><span class="profile-value">${escapeHtml(u.category)}</span></div>
        <div><span class="profile-label">District</span><span class="profile-value">${escapeHtml(u.district)}</span></div>
        <div><span class="profile-label">Rating</span><span class="profile-value">${starDisplay(u.ratingAvg)} (${u.ratingCount})</span></div>
        <div><span class="profile-label">Enrolled since</span><span class="profile-value">${new Date(u.createdAt).toLocaleDateString()}</span></div>
      </div>`;
  }

  function onShow() {
    refreshAssignments();
    refreshChat();
    renderProfile();
    checkNotifications();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { refreshAssignments(); checkNotifications(); }, 4000);
    clearInterval(chatPollTimer);
    chatPollTimer = setInterval(refreshChat, 5000);
  }
  function onHide() { clearInterval(pollTimer); clearInterval(chatPollTimer); }

  return { init, onShow, onHide };
})();
