const Citizen = (() => {
  let chatPollTimer, listPollTimer;

  function init() {
    const catSelect = document.getElementById("f-category");
    CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      catSelect.appendChild(opt);
    });

    const center = DISTRICT_COORDS[App.user.district];
    LocationPhotoWidget.init(center, center ? 12 : undefined);

    document.getElementById("issue-form").addEventListener("submit", handleSubmit);
    document.getElementById("citizen-chat-form").addEventListener("submit", handleChatSend);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById("form-error");
    errorEl.hidden = true;
    const category = document.getElementById("f-category").value;
    const description = document.getElementById("f-desc").value.trim();
    const address = document.getElementById("f-address").value.trim();
    const st = LocationPhotoWidget.getState();

    if (!category) { errorEl.textContent = "Choose a category."; errorEl.hidden = false; return; }
    if (!description) { errorEl.textContent = "Add a description."; errorEl.hidden = false; return; }
    if (st.lat == null) { errorEl.textContent = "Set a location — use GPS or tap the map."; errorEl.hidden = false; return; }

    const method = [st.locationMethod, st.photoMethod].filter(Boolean).join(" + ") || "Manual";
    try {
      await api("POST", "/api/complaints", {
        category, description, address, method,
        lat: st.lat, lng: st.lng, photoBase64: st.photoBase64
      });
      toast("Report filed — track it under \"My complaints.\"");
      document.getElementById("issue-form").reset();
      LocationPhotoWidget.reset();
      refreshMine();
      refreshMap();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function ticketCard(c) {
    const photo = c.photoUrl ? `<img src="${c.photoUrl}" class="ticket-thumb" alt="" />` : "";
    let feedbackBlock = "";
    if (c.status === "Completed") {
      feedbackBlock = `<form class="feedback-form" data-feedback-for="${c.id}">
        <label>How was it fixed?</label>
        <select class="fb-rating">
          <option value="5">★★★★★ Excellent</option>
          <option value="4">★★★★ Good</option>
          <option value="3">★★★ OK</option>
          <option value="2">★★ Poor</option>
          <option value="1">★ Very poor</option>
        </select>
        <input type="text" class="fb-comment" placeholder="Optional comment" />
        <button type="submit" class="btn btn-amber btn-sm">Submit feedback</button>
      </form>`;
    } else if (c.status === "Closed" && c.feedbackRating) {
      feedbackBlock = `<div class="feedback-given">Your feedback: ${"★".repeat(c.feedbackRating)}${c.feedbackComment ? " — " + escapeHtml(c.feedbackComment) : ""}</div>`;
    }
    const scheduled = c.scheduledAt ? `<div class="ticket-meta">Scheduled: ${new Date(c.scheduledAt).toLocaleString()}</div>` : "";
    const rejected = c.status === "Rejected" && c.rejectReason ? `<div class="ticket-meta">Reason: ${escapeHtml(c.rejectReason)}</div>` : "";
    return `<div class="ticket ticket-wide">
      ${photo}
      <div class="ticket-main">
        <div class="ticket-cat">${escapeHtml(c.category)}</div>
        <div class="ticket-desc">${escapeHtml(c.description)}</div>
        <div class="ticket-meta"><span class="ticket-id">${c.id}</span> · filed ${timeAgo(c.createdAt)}${c.address ? " · " + escapeHtml(c.address) : ""}</div>
        ${scheduled}${rejected}${feedbackBlock}
      </div>
      <span class="stamp ${statusStampClass(c.status)}">${c.status}</span>
    </div>`;
  }

  async function refreshMine() {
    try {
      const { complaints } = await api("GET", "/api/complaints/mine");
      const el = document.getElementById("my-complaints-list");
      el.innerHTML = complaints.length ? complaints.map(ticketCard).join("") : `<div class="ticket-empty">You haven't filed any reports yet.</div>`;
      el.querySelectorAll("[data-feedback-for]").forEach(form => {
        form.addEventListener("submit", async e => {
          e.preventDefault();
          const id = form.dataset.feedbackFor;
          const rating = form.querySelector(".fb-rating").value;
          const comment = form.querySelector(".fb-comment").value.trim();
          try {
            await api("POST", `/api/complaints/${id}/feedback`, { rating: Number(rating), comment });
            toast("Thanks — feedback submitted.");
            refreshMine();
          } catch (err) { toast(err.message, true); }
        });
      });
    } catch (err) { toast(err.message, true); }
  }

  async function refreshMap() {
    try {
      const { points } = await api("GET", "/api/complaints/map");
      markersLayer.clearLayers();
      const pts = [];
      points.forEach(p => {
        L.circleMarker([p.lat, p.lng], { radius: 7, color: statusMarkerColor(p.status), fillColor: statusMarkerColor(p.status), fillOpacity: 0.85, weight: 2 })
          .bindPopup(`<strong>${escapeHtml(p.category)}</strong><br/>${escapeHtml(p.status)}`)
          .addTo(markersLayer);
        pts.push([p.lat, p.lng]);
      });
      if (pts.length) map.fitBounds(pts, { maxZoom: 13, padding: [20, 20] });
    } catch (err) { /* silent */ }
  }

  async function refreshChat() {
    try {
      const { messages } = await api("GET", `/api/messages/thread/${App.user.id}`);
      const log = document.getElementById("citizen-chat-log");
      log.innerHTML = messages.length
        ? messages.map(m => `<div class="chat-msg ${m.from_role === "admin" ? "chat-msg-them" : "chat-msg-me"}">
            <span class="chat-msg-role">${m.from_role === "admin" ? "Department" : "You"}</span>
            <span class="chat-msg-text">${escapeHtml(m.text)}</span>
            <span class="chat-msg-time">${timeAgo(m.at)}</span>
          </div>`).join("")
        : `<div class="ticket-empty">No messages yet — say hello to the department.</div>`;
      log.scrollTop = log.scrollHeight;
    } catch (err) { /* silent */ }
  }

  async function handleChatSend(e) {
    e.preventDefault();
    const input = document.getElementById("citizen-chat-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api("POST", "/api/messages", { text });
      input.value = "";
      refreshChat();
    } catch (err) { toast(err.message, true); }
  }

  function renderProfile() {
    const u = App.user;
    document.getElementById("citizen-profile-panel").innerHTML = `
      <h2 class="panel-title">My profile</h2>
      <div class="profile-grid">
        <div><span class="profile-label">Name</span><span class="profile-value">${escapeHtml(u.name)}</span></div>
        <div><span class="profile-label">Email</span><span class="profile-value">${escapeHtml(u.email)}</span></div>
        <div><span class="profile-label">Phone</span><span class="profile-value">${escapeHtml(u.phone || "—")}</span></div>
        <div><span class="profile-label">District</span><span class="profile-value">${escapeHtml(u.district)}</span></div>
        <div><span class="profile-label">Role</span><span class="profile-value">Citizen</span></div>
        <div><span class="profile-label">Member since</span><span class="profile-value">${new Date(u.createdAt).toLocaleDateString()}</span></div>
      </div>`;
  }

  function onShow() {
    refreshMine();
    refreshMap();
    refreshChat();
    renderProfile();
    setTimeout(() => { LocationPhotoWidget.invalidateSize(); map.invalidateSize(); }, 50);
    clearInterval(listPollTimer);
    listPollTimer = setInterval(() => { refreshMine(); }, 6000);
    clearInterval(chatPollTimer);
    chatPollTimer = setInterval(refreshChat, 5000);
  }
  function onHide() {
    clearInterval(listPollTimer);
    clearInterval(chatPollTimer);
  }

  return { init, onShow, onHide };
})();
