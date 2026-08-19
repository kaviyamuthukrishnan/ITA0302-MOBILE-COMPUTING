const AuthUI = (() => {
  let currentRole = "citizen";

  function init() {
    const catSelect = document.getElementById("signup-category");
    CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      catSelect.appendChild(opt);
    });

    const distSelect = document.getElementById("signup-district");
    const loginDistPicker = document.getElementById("login-district-picker");
    TN_DISTRICTS.forEach(d => {
      const opt1 = document.createElement("option");
      opt1.value = d; opt1.textContent = d;
      distSelect.appendChild(opt1);
      const opt2 = document.createElement("option");
      opt2.value = d; opt2.textContent = d;
      loginDistPicker.appendChild(opt2);
    });
    loginDistPicker.addEventListener("change", () => {
      const emailField = document.getElementById("login-email");
      if (!loginDistPicker.value) { emailField.value = "admin@fixpoint.local"; return; }
      const slug = loginDistPicker.value.toLowerCase().replace(/[^a-z]/g, "");
      emailField.value = `admin.${slug}@fixpoint.local`;
    });

    document.querySelectorAll(".role-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".role-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentRole = btn.dataset.role;
        onRoleChange();
      });
    });

    document.querySelectorAll(".mode-tab").forEach(btn => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    document.getElementById("signup-category-field").hidden = true;
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("signup-form").addEventListener("submit", handleSignup);

    onRoleChange();
  }

  function onRoleChange() {
    const modeTabs = document.getElementById("auth-mode-tabs");
    const hint = document.getElementById("login-hint");
    const distField = document.getElementById("login-district-field");
    if (currentRole === "admin") {
      modeTabs.hidden = true;
      setMode("login");
      hint.hidden = false;
      distField.hidden = false;
    } else {
      modeTabs.hidden = false;
      hint.hidden = true;
      distField.hidden = true;
    }
    document.getElementById("signup-category-field").hidden = currentRole !== "worker";
  }

  function setMode(mode) {
    document.querySelectorAll(".mode-tab").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    document.getElementById("login-form").hidden = mode !== "login";
    document.getElementById("signup-form").hidden = mode !== "signup";
  }

  async function handleLogin(e) {
    e.preventDefault();
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      const { token, user } = await api("POST", "/api/auth/login", { email, password });
      if (user.role !== currentRole) {
        errorEl.textContent = `That account is registered as ${user.role}, not ${currentRole}. Switch tabs above.`;
        errorEl.hidden = false;
        return;
      }
      setToken(token);
      App.onAuthenticated(user);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    const errorEl = document.getElementById("signup-error");
    errorEl.hidden = true;
    const body = {
      role: currentRole,
      name: document.getElementById("signup-name").value.trim(),
      email: document.getElementById("signup-email").value.trim(),
      phone: document.getElementById("signup-phone").value.trim(),
      district: document.getElementById("signup-district").value,
      password: document.getElementById("signup-password").value
    };
    if (currentRole === "worker") body.category = document.getElementById("signup-category").value;
    try {
      const { token, user } = await api("POST", "/api/auth/signup", body);
      setToken(token);
      App.onAuthenticated(user);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function show() {
    document.getElementById("screen-auth").hidden = false;
  }
  function hide() {
    document.getElementById("screen-auth").hidden = true;
  }

  return { init, show, hide };
})();
