/* Unified location + photo capture widget.
   Works the same on a laptop (webcam) or a phone (rear camera) —
   no separate code paths, just feature-detection with graceful fallback. */

const LocationPhotoWidget = (() => {
  let map, marker;
  let stream = null;
  let state = { lat: null, lng: null, locationMethod: null, photoBase64: null, photoMethod: null };
  let defaultCenter = TN_CENTER, defaultZoom = 7;

  function init(center, zoom) {
    if (center) { defaultCenter = center; defaultZoom = zoom || 11; }
    map = L.map("pick-map").setView(defaultCenter, defaultZoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    map.on("click", e => setLocation(e.latlng.lat, e.latlng.lng, "Manual pin"));

    document.getElementById("use-location-btn").addEventListener("click", useGps);
    document.getElementById("open-camera-btn").addEventListener("click", openCamera);
    document.getElementById("capture-btn").addEventListener("click", capturePhoto);
    document.getElementById("cancel-camera-btn").addEventListener("click", closeCamera);
    document.getElementById("f-photo-file").addEventListener("change", handleFileUpload);

    reset();
  }

  function setLocation(lat, lng, method) {
    state.lat = lat; state.lng = lng; state.locationMethod = method;
    document.getElementById("loc-readout").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} (${method})`;
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng]).addTo(map);
    map.setView([lat, lng], 16);
  }

  function useGps() {
    if (!navigator.geolocation) { toast("Geolocation isn't available in this browser.", true); return; }
    const btn = document.getElementById("use-location-btn");
    btn.disabled = true; btn.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      pos => { setLocation(pos.coords.latitude, pos.coords.longitude, "Live GPS"); btn.disabled = false; btn.textContent = "Use my GPS"; },
      () => { toast("Couldn't get GPS — tap the map to pin it instead.", true); btn.disabled = false; btn.textContent = "Use my GPS"; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Live camera isn't available here — use Upload / take photo instead.", true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = document.getElementById("camera-video");
      video.srcObject = stream;
      document.getElementById("camera-wrap").hidden = false;
    } catch (e) {
      toast("Camera permission denied — use Upload / take photo instead.", true);
    }
  }

  function closeCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    document.getElementById("camera-wrap").hidden = true;
  }

  function capturePhoto() {
    const video = document.getElementById("camera-video");
    const canvas = document.getElementById("camera-canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    state.photoBase64 = canvas.toDataURL("image/jpeg", 0.85);
    state.photoMethod = "Live camera";
    showPreview(state.photoBase64);
    closeCamera();
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast("Photo is too large — pick one under 6MB.", true); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      state.photoBase64 = reader.result;
      state.photoMethod = "Uploaded photo";
      showPreview(state.photoBase64);
    };
    reader.readAsDataURL(file);
  }

  function showPreview(src) {
    const preview = document.getElementById("photo-preview");
    preview.src = src;
    preview.hidden = false;
  }

  function reset() {
    state = { lat: null, lng: null, locationMethod: null, photoBase64: null, photoMethod: null };
    document.getElementById("loc-readout").textContent = "Not set — use GPS or tap the map";
    document.getElementById("photo-preview").hidden = true;
    document.getElementById("f-photo-file").value = "";
    if (marker) { map.removeLayer(marker); marker = null; }
    closeCamera();
    if (map) map.setView(defaultCenter, defaultZoom);
  }

  function getState() { return state; }
  function invalidateSize() { if (map) map.invalidateSize(); }

  return { init, reset, getState, invalidateSize };
})();
