const App = (() => {
  let user = null;
  let currentScreen = null;
  const inited = { citizen: false, admin: false, worker: false };

  const NAV = {
    citizen: [
      { key: "raise", label: "Raise Issue" },
      { key: "mine", label: "My Complaints" },
      { key: "messages", label: "Messages" },
      { key: "profile", label: "Profile" }
    ],
    admin: [
      { key: "review", label: "Review" },
      { key: "approvals", label: "Approvals" },
      { key: "tracking", label: "Assign & Track" },
      { key: "completed", label: "Completed" },
      { key: "feedback", label: "Feedback & Chat" },
      { key: "overview", label: "Overview" }
    ],
    worker: [
      { key: "assignments", label: "Assignments" },
      { key: "active", label: "My Jobs" },
      { key: "messages", label: "Messages" },
      { key: "profile", label: "Profile" }
    ]
  };
  const ROLE_LABEL = { citizen: "Citizen", admin: "Department", worker: "Worker" };
  const MODULE = { citizen: Citizen, admin: Admin, worker: Worker };

  async function boot() {
    AuthUI.init();
    document.getElementById("logout-btn").addEventListener("click", logout);

    const token = getToken();
    if (token) {
      try {
        const { user: u } = await api("GET", "/api/me");
        onAuthenticated(u);
        return;
      } catch (e) {
        setToken(null);
      }
    }
    AuthUI.show();
  }

  function onAuthenticated(u) {
    user = u;
    App.user = u;
    AuthUI.hide();
    showDashboard(u.role);
  }

  function showDashboard(role) {
    if (currentScreen && MODULE[currentScreen]) MODULE[currentScreen].onHide();

    ["citizen", "admin", "worker"].forEach(r => {
      document.getElementById(`screen-${r}`).hidden = r !== role;
    });
    document.getElementById("dash-topbar").hidden = false;
    const scopeLabel = role === "admin"
      ? (user.district ? user.district + " Department" : "State Department (all districts)")
      : ROLE_LABEL[role] + (user.district ? " · " + user.district : "");
    document.getElementById("dash-role-tag").textContent = scopeLabel;
    document.getElementById("user-chip").textContent = `${user.name} · ${ROLE_LABEL[role]}`;
    currentScreen = role;

    renderNav(role);
    if (!inited[role]) { MODULE[role].init(); inited[role] = true; }
    switchPage(role, NAV[role][0].key);
    MODULE[role].onShow();
  }

  function renderNav(role) {
    const nav = document.getElementById("dash-nav");
    nav.innerHTML = NAV[role].map((item, i) => `<button class="tab ${i === 0 ? "active" : ""}" data-page="${item.key}">${item.label}</button>`).join("");
    nav.querySelectorAll("[data-page]").forEach(btn => {
      btn.addEventListener("click", () => {
        nav.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        switchPage(role, btn.dataset.page);
      });
    });
  }

  function switchPage(role, pageKey) {
    NAV[role].forEach(item => {
      const el = document.getElementById(`page-${role}-${item.key}`);
      if (el) el.hidden = item.key !== pageKey;
    });
    setTimeout(() => {
      if (role === "citizen") { LocationPhotoWidget.invalidateSize(); }
    }, 30);
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout"); } catch (e) { /* ignore */ }
    setToken(null);
    if (currentScreen && MODULE[currentScreen]) MODULE[currentScreen].onHide();
    user = null; App.user = null; currentScreen = null;
    document.getElementById("dash-topbar").hidden = true;
    ["citizen", "admin", "worker"].forEach(r => { document.getElementById(`screen-${r}`).hidden = true; });
    document.getElementById("login-form").reset();
    AuthUI.show();
  }

  document.addEventListener("DOMContentLoaded", boot);

  return { onAuthenticated, user };
})();
