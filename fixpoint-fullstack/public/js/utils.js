/* ============ API wrapper ============ */
const API_BASE = "";

function getToken() { return localStorage.getItem("fp_token") || ""; }
function setToken(t) { if (t) localStorage.setItem("fp_token", t); else localStorage.removeItem("fp_token"); }

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ============ Small utilities ============ */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toast(msg, isError) {
  const el = document.getElementById("toast");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.borderLeftColor = isError ? "#A63D2E" : "#E8A33D";
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}
function statusStampClass(status) {
  return {
    "Submitted": "stamp-reported", "Approved": "stamp-reported", "Assigned": "stamp-progress",
    "Scheduled": "stamp-progress", "In Progress": "stamp-progress", "Completed": "stamp-resolved",
    "Closed": "stamp-resolved", "Rejected": "stamp-rejected"
  }[status] || "stamp-reported";
}
function statusMarkerColor(status) {
  if (status === "Rejected") return "#A63D2E";
  if (status === "Completed" || status === "Closed") return "#4C7A5E";
  if (["Assigned", "Scheduled", "In Progress"].includes(status)) return "#E8A33D";
  return "#2F6F8F";
}
function starDisplay(avg) {
  if (avg == null) return "No ratings yet";
  return `★ ${avg.toFixed(1)}`;
}

const CATEGORIES = [
  "Roads & Potholes",
  "Garbage & Sanitation",
  "Water Supply",
  "Street Lighting & Electrical",
  "Public Property / Other"
];

const TN_DISTRICTS = [
  "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul",
  "Erode", "Kallakurichi", "Kanchipuram", "Kanniyakumari", "Karur", "Krishnagiri",
  "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur",
  "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
  "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupattur",
  "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram",
  "Virudhunagar"
];

/* Approximate district-headquarters coordinates, used to center maps on the
   relevant district instead of showing the whole world / whole country. */
const DISTRICT_COORDS = {
  "Chengalpattu": [12.6819, 79.9888], "Chennai": [13.0827, 80.2707], "Coimbatore": [11.0168, 76.9558],
  "Cuddalore": [11.7480, 79.7714], "Dharmapuri": [12.1211, 78.1582], "Dindigul": [10.3624, 77.9695],
  "Erode": [11.3410, 77.7172], "Kallakurichi": [11.7401, 78.9597], "Kanchipuram": [12.8342, 79.7036],
  "Kanniyakumari": [8.0883, 77.5385], "Karur": [10.9601, 78.0766], "Krishnagiri": [12.5266, 78.2150],
  "Madurai": [9.9252, 78.1198], "Mayiladuthurai": [11.1085, 79.6529], "Nagapattinam": [10.7672, 79.8449],
  "Namakkal": [11.2189, 78.1677], "Nilgiris": [11.4064, 76.6932], "Perambalur": [11.2333, 78.8667],
  "Pudukkottai": [10.3813, 78.8213], "Ramanathapuram": [9.3639, 78.8395], "Ranipet": [12.9247, 79.3325],
  "Salem": [11.6643, 78.1460], "Sivaganga": [9.8433, 78.4809], "Tenkasi": [8.9605, 77.3152],
  "Thanjavur": [10.7867, 79.1378], "Theni": [10.0104, 77.4768], "Thoothukudi": [8.7642, 78.1348],
  "Tiruchirappalli": [10.7905, 78.7047], "Tirunelveli": [8.7139, 77.7567], "Tirupattur": [12.4966, 78.5730],
  "Tiruppur": [11.1085, 77.3411], "Tiruvallur": [13.1231, 79.9088], "Tiruvannamalai": [12.2253, 79.0747],
  "Tiruvarur": [10.7661, 79.6345], "Vellore": [12.9165, 79.1325], "Viluppuram": [11.9401, 79.4861],
  "Virudhunagar": [9.5851, 77.9581]
};
const TN_CENTER = [10.9, 78.6]; // roughly the middle of Tamil Nadu, used for the super-admin's overview
