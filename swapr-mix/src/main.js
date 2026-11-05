/**
 * Swapr Mix — replace a marked person and marked props (fork of Swapr).
 * Original Swapr remains on wan22-templates main / production hosts.
 *
 * Templates from HF dataset CDN. Generate goes through same-origin
 * /api/generate when USE_PROXY is true (required on iPhone). Green points
 * and the person still replace a person. Red points and the prop still
 * replace a prop. The server composites both stills into the one reference
 * image Runpod accepts.
 */
import { inject } from '@vercel/analytics';
import { generateFailureText, publicErrorText } from "../server/gatewayError.js";
import { MIX_DEFAULT_PROMPT, MIX_PROP_PROMPT, LEGACY_KEEP_PROMPTS } from "../server/mixPoints.js";
import { rewriteSpaceVideoUrl } from "../server/videoUrl.js";

// Initialize Vercel Web Analytics
inject();

const cfg = window.CONFIG || {};
const SPACE = import.meta.env.VITE_HF_SPACE || cfg.HF_SPACE || "https://simzy-wan-2-2-templates.hf.space";
const CATALOG_URL =
  import.meta.env.VITE_CATALOG_URL ||
  cfg.CATALOG_URL ||
  "https://huggingface.co/datasets/Simzy/wan22-template-clips/resolve/main/templates/catalog.json";
const CDN_BASE =
  cfg.DATASET_CDN_BASE ||
  "https://huggingface.co/datasets/Simzy/wan22-template-clips/resolve/main/";
const USE_PROXY = cfg.USE_PROXY === true;
const GENERATE_WAIT =
  "The first Generate may take several minutes while the Runpod worker starts. Leave this tab open.";
const EXTEND_WAIT = "Extend uses the Hugging Face Space and can take several minutes. Leave this tab open.";

let templates = [];
let selectedId = null;
let personFiles = [];
let propFiles = [];
const previewUrls = { person: [], prop: [] };
let lastResultUrl = null;
/** Session id returned by Space /generate for /extend API calls. */
let sessionId = "";
/** Runpod job id of the Generate in flight (Vercel). Used by Stop GPU. */
let currentRunpodJob = "";
let lastResultBlob = null;

/** SAM marks in natural video-frame pixels. Green = person, red = prop. */
let positivePoints = [];
let propPoints = [];
let maskMode = "person";
let frameNatural = { width: 0, height: 0 };
let frameBitmap = null;

const els = {
  rail: document.getElementById("template-rail"),
  status: document.getElementById("templates-status"),
  refresh: document.getElementById("btn-refresh"),
  selectedPanel: document.getElementById("selected-panel"),
  selectedTitle: document.getElementById("selected-title"),
  selectedDesc: document.getElementById("selected-desc"),
  maskSection: document.getElementById("mask-section"),
  maskHint: document.getElementById("mask-hint"),
  maskCanvas: document.getElementById("mask-canvas"),
  maskStatus: document.getElementById("mask-status"),
  maskModePerson: document.getElementById("mask-mode-person"),
  maskModeProp: document.getElementById("mask-mode-prop"),
  maskClear: document.getElementById("mask-clear"),
  uploadSection: document.getElementById("upload-section"),
  uploadHint: document.getElementById("upload-hint"),
  uploadZone: document.getElementById("upload-zone"),
  uploadInner: document.getElementById("upload-inner"),
  photoInput: document.getElementById("photo-input"),
  personPreviews: document.getElementById("person-previews"),
  propZone: document.getElementById("prop-upload-zone"),
  propInner: document.getElementById("prop-upload-inner"),
  propInput: document.getElementById("prop-input"),
  propPreviews: document.getElementById("prop-previews"),
  prompt: document.getElementById("prompt"),
  gateHint: document.getElementById("gate-hint"),
  btnGen: document.getElementById("btn-generate"),
  genStatus: document.getElementById("gen-status"),
  resultPanel: document.getElementById("result-panel"),
  resultVideo: document.getElementById("result-video"),
  btnDownload: document.getElementById("btn-download"),
  btnSave: document.getElementById("btn-save-photos"),
  balance: document.getElementById("runpod-balance"),
  btnStop: document.getElementById("btn-stop-gpu"),
  stopStatus: document.getElementById("stop-status"),
  btnExtend: document.getElementById("btn-extend"),
  btnAuto: document.getElementById("btn-auto-extend"),
  extendTarget: document.getElementById("extend-target"),
  extendTargetVal: document.getElementById("extend-target-val"),
  howtoBtn: document.getElementById("btn-howto"),
  howtoDialog: document.getElementById("howto-dialog"),
  howtoClose: document.getElementById("btn-howto-close"),
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let playObserver = null;

function videoUrl(t) {
  if (t.video_url) return t.video_url;
  const rel = t.video_path || t.video || "";
  return CDN_BASE + rel.replace(/^\//, "");
}

/** Read the motion clip's pixel size so the worker and the still use its aspect. */
const sizeCache = new Map();
function templateSize(t) {
  if (!t) return Promise.resolve(null);
  if (sizeCache.has(t.id)) return Promise.resolve(sizeCache.get(t.id));
  const card = els.rail.querySelector(`.tcard[data-id="${CSS.escape(t.id)}"] video`);
  if (card && card.videoWidth && card.videoHeight) {
    const size = { width: card.videoWidth, height: card.videoHeight };
    sizeCache.set(t.id, size);
    return Promise.resolve(size);
  }
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    const done = (size) => {
      if (size) sizeCache.set(t.id, size);
      v.removeAttribute("src");
      resolve(size);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.addEventListener("loadedmetadata", () => {
      clearTimeout(timer);
      done(v.videoWidth && v.videoHeight ? { width: v.videoWidth, height: v.videoHeight } : null);
    });
    v.addEventListener("error", () => {
      clearTimeout(timer);
      done(null);
    });
    v.src = videoUrl(t);
  });
}

/** Worker size for a template, mirrored from server/runpod.js targetSize. */
function workerSize(size) {
  if (!size) return { width: 480, height: 832 };
  const ratio = size.width / size.height;
  if (ratio > 1.15) return { width: 832, height: 480 };
  if (ratio < 0.87) return { width: 480, height: 832 };
  return { width: 640, height: 640 };
}

function generateBlockReason() {
  if (!selectedId) return "Pick a motion first.";
  if (!positivePoints.length) return "Tap the person to replace (green).";
  if (!personFiles.length) return "Upload a replacement image for the green-dot person.";
  if (propPoints.length && !propFiles.length) return "Upload a replacement image for the red-dot prop.";
  if (propFiles.length && !propPoints.length) return "Tap the prop to replace (red).";
  return "";
}

function updateGenerateEnabled() {
  const reason = generateBlockReason();
  els.btnGen.disabled = Boolean(reason);
  els.btnGen.title = reason;
  if (els.gateHint) els.gateHint.textContent = selectedId ? reason : "";
}

function setMaskMode(mode) {
  maskMode = mode === "prop" ? "prop" : "person";
  els.maskModePerson?.classList.toggle("active", maskMode === "person");
  els.maskModeProp?.classList.toggle("active", maskMode === "prop");
  els.maskModePerson?.setAttribute("aria-pressed", maskMode === "person" ? "true" : "false");
  els.maskModeProp?.setAttribute("aria-pressed", maskMode === "prop" ? "true" : "false");
}

function updateMaskStatus() {
  if (!els.maskStatus) return;
  const p = positivePoints.length;
  const n = propPoints.length;
  if (!p && !n) {
    els.maskStatus.textContent = "No marks yet. Tap the person to replace (green), then the prop to replace (red).";
    return;
  }
  els.maskStatus.textContent = `${p} person mark${p === 1 ? "" : "s"} · ${n} prop mark${n === 1 ? "" : "s"}`;
}

function drawMaskCanvas() {
  const canvas = els.maskCanvas;
  if (!canvas || !frameBitmap) return;
  const ctx = canvas.getContext("2d");
  const maxW = Math.min(520, canvas.parentElement?.clientWidth || 360);
  const scale = maxW / frameBitmap.width;
  const w = Math.max(1, Math.round(frameBitmap.width * scale));
  const h = Math.max(1, Math.round(frameBitmap.height * scale));
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(frameBitmap, 0, 0, w, h);
  const sx = w / frameNatural.width;
  const sy = h / frameNatural.height;
  for (const pt of positivePoints) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(74, 222, 128, 0.95)";
    ctx.strokeStyle = "#052e16";
    ctx.lineWidth = 2;
    ctx.arc(pt.x * sx, pt.y * sy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const pt of propPoints) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(248, 113, 113, 0.95)";
    ctx.strokeStyle = "#450a0a";
    ctx.lineWidth = 2;
    ctx.arc(pt.x * sx, pt.y * sy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function clearMaskPoints() {
  positivePoints = [];
  propPoints = [];
  updateMaskStatus();
  drawMaskCanvas();
  updateGenerateEnabled();
}

async function loadMaskFrame(t) {
  if (!els.maskSection || !els.maskCanvas || !t) return;
  els.maskSection.hidden = false;
  els.maskSection.classList.remove("is-locked");
  els.maskSection.setAttribute("aria-disabled", "false");
  clearMaskPoints();
  const url = videoUrl(t);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Template frame timed out")), 20000);
    video.addEventListener(
      "loadeddata",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Could not load the template frame"));
      },
      { once: true },
    );
    video.src = url;
  });
  try {
    video.currentTime = Math.min(0.12, (video.duration || 1) * 0.05);
    await new Promise((resolve) => {
      video.addEventListener("seeked", resolve, { once: true });
      setTimeout(resolve, 400);
    });
  } catch {
    /* use first decoded frame */
  }
  frameNatural = { width: video.videoWidth || 480, height: video.videoHeight || 832 };
  if (frameBitmap && typeof frameBitmap.close === "function") frameBitmap.close();
  frameBitmap = await createImageBitmap(video);
  video.removeAttribute("src");
  video.load();
  drawMaskCanvas();
  updateMaskStatus();
}

function canvasToNatural(event) {
  const canvas = els.maskCanvas;
  const rect = canvas.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY;
  if (clientX == null || clientY == null || !frameNatural.width) return null;
  const x = ((clientX - rect.left) / rect.width) * frameNatural.width;
  const y = ((clientY - rect.top) / rect.height) * frameNatural.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.min(frameNatural.width, x)),
    y: Math.max(0, Math.min(frameNatural.height, y)),
  };
}

function onMaskPointer(event) {
  if (!selectedId || !frameBitmap) return;
  event.preventDefault();
  const pt = canvasToNatural(event);
  if (!pt) return;
  if (maskMode === "prop") propPoints.push(pt);
  else positivePoints.push(pt);
  updateMaskStatus();
  drawMaskCanvas();
  updateGenerateEnabled();
}

function armVideo(vid) {
  vid.muted = true;
  vid.defaultMuted = true;
  vid.loop = true;
  vid.playsInline = true;
  vid.autoplay = true;
  vid.setAttribute("muted", "");
  vid.setAttribute("playsinline", "");
  vid.setAttribute("webkit-playsinline", "");
  if (!vid.getAttribute("src") && vid.dataset.src) vid.src = vid.dataset.src;
}

function visibleRatio(el) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const w = Math.min(rect.right, vw) - Math.max(rect.left, 0);
  const h = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
  return (Math.max(0, w) / rect.width) * (Math.max(0, h) / rect.height);
}

function syncPlayback() {
  els.rail.querySelectorAll("video").forEach((vid) => {
    const selected = vid.closest(".tcard")?.classList.contains("active");
    const ratio = visibleRatio(vid);
    const shouldPlay = !reduceMotion && (ratio >= 0.12 || (selected && ratio > 0.02));
    if (shouldPlay) {
      armVideo(vid);
      vid.play().catch(() => {
        vid.controls = true;
      });
    } else {
      vid.pause();
    }
  });
}

function observeRail() {
  if (playObserver) playObserver.disconnect();
  playObserver = new IntersectionObserver(() => syncPlayback(), {
    root: null,
    rootMargin: "80px 120px",
    threshold: [0, 0.15, 0.4, 0.75],
  });
  els.rail.querySelectorAll("video").forEach((vid) => playObserver.observe(vid));
  syncPlayback();
}

function lockUpload() {
  els.uploadSection.classList.add("is-locked");
  els.uploadSection.classList.remove("is-ready");
  els.uploadSection.setAttribute("aria-disabled", "true");
  els.photoInput.disabled = true;
  if (els.propInput) els.propInput.disabled = true;
  els.uploadHint.textContent = "Pick a motion above to unlock replacement stills.";
  els.selectedPanel.hidden = true;
}

function focusUpload() {
  els.uploadSection.classList.remove("is-locked");
  els.uploadSection.classList.add("is-ready");
  els.uploadSection.setAttribute("aria-disabled", "false");
  els.photoInput.disabled = false;
  if (els.propInput) els.propInput.disabled = false;
  els.uploadHint.textContent = "Upload a still for the green-dot person, and a still for the red-dot prop.";
  els.uploadSection.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  els.uploadSection.focus({ preventScroll: true });
}

async function loadCatalog() {
  els.status.textContent = "Loading templates…";
  els.rail.innerHTML = "";
  try {
    const res = await fetch(CATALOG_URL + (CATALOG_URL.includes("?") ? "&" : "?") + "t=" + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    templates = await res.json();
    if (!Array.isArray(templates) || !templates.length) {
      els.status.textContent = "No templates in catalog yet.";
      lockUpload();
      return;
    }
    if (selectedId && !templates.some((t) => t.id === selectedId)) {
      selectedId = null;
      lockUpload();
    }
    els.status.textContent = `${templates.length} motions · swipe to see them all`;
    for (const t of templates) {
      const card = document.createElement("article");
      card.className = "tcard" + (t.id === selectedId ? " active" : "");
      card.dataset.id = t.id;
      card.setAttribute("role", "listitem");
      const url = videoUrl(t);
      const title = t.title || t.id;
      const dur = t.duration_s ?? "?";
      card.innerHTML = `
        <div class="tcard-media">
          <video muted loop playsinline webkit-playsinline autoplay preload="none" data-src="${escapeHtml(url)}" aria-label="${escapeHtml(title)}"></video>
        </div>
        <div class="meta">
          <strong>${escapeHtml(title)}</strong>
          <span>~${escapeHtml(dur)}s · ${escapeHtml(t.category || "motion")}</span>
        </div>
        <button type="button" class="tcard-hit" aria-pressed="${t.id === selectedId ? "true" : "false"}" aria-label="Select ${escapeHtml(title)}">
          <span class="tcard-cta">${t.id === selectedId ? "Selected" : "Select"}</span>
        </button>`;
      card.querySelector(".tcard-hit").addEventListener("click", () => selectTemplate(t.id));
      els.rail.appendChild(card);
    }
    observeRail();
    if (selectedId) selectTemplate(selectedId, { scrollUpload: false });
  } catch (e) {
    console.error(e);
    els.status.textContent = `Could not load catalog: ${e.message}`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectTemplate(id, opts = {}) {
  const scrollUpload = opts.scrollUpload !== false;
  selectedId = id;
  const t = templates.find((x) => x.id === id);
  document.querySelectorAll(".tcard").forEach((el) => {
    const on = el.dataset.id === id;
    el.classList.toggle("active", on);
    const hit = el.querySelector(".tcard-hit");
    if (hit) {
      hit.setAttribute("aria-pressed", on ? "true" : "false");
      const cta = hit.querySelector(".tcard-cta");
      if (cta) cta.textContent = on ? "Selected" : "Select";
    }
    if (on && scrollUpload) {
      const left = el.offsetLeft - (els.rail.clientWidth - el.clientWidth) / 2;
      els.rail.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? "auto" : "smooth" });
    }
  });
  if (!t) {
    lockUpload();
    if (els.maskSection) {
      els.maskSection.hidden = true;
      els.maskSection.classList.add("is-locked");
    }
    updateGenerateEnabled();
    return;
  }
  els.selectedPanel.hidden = false;
  els.selectedTitle.textContent = t.title || t.id;
  els.selectedDesc.textContent = t.description || "";
  syncPlayback();
  loadMaskFrame(t).catch((e) => {
    if (els.maskStatus) els.maskStatus.textContent = `Could not load frame: ${e.message}`;
  });
  focusUpload();
  updateGenerateEnabled();
  if (scrollUpload) {
    els.maskSection?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
}

function imageFiles(fileList) {
  return [...(fileList || [])].filter((file) => file && String(file.type || "").startsWith("image/"));
}

function revokePreviews(kind) {
  for (const url of previewUrls[kind]) URL.revokeObjectURL(url);
  previewUrls[kind] = [];
}

function renderPreviews(kind) {
  const files = kind === "prop" ? propFiles : personFiles;
  const host = kind === "prop" ? els.propPreviews : els.personPreviews;
  const inner = kind === "prop" ? els.propInner : els.uploadInner;
  if (!host) return;
  revokePreviews(kind);
  host.replaceChildren();
  if (!files.length) {
    host.hidden = true;
    if (inner) inner.hidden = false;
    return;
  }
  if (inner) inner.hidden = true;
  host.hidden = false;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    previewUrls[kind].push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = kind === "prop" ? "Prop replacement preview" : "Person replacement preview";
    host.appendChild(img);
  }
}

function setStills(kind, fileList) {
  const input = kind === "prop" ? els.propInput : els.photoInput;
  if (!selectedId || !input || input.disabled) return;
  const files = imageFiles(fileList);
  if (!files.length) return;
  if (kind === "prop") propFiles = files;
  else personFiles = files;
  renderPreviews(kind);
  updateGenerateEnabled();
}

function bindStillInput(input, zone, kind) {
  if (!input) return;
  input.addEventListener("change", () => {
    if (input.files && input.files.length) setStills(kind, input.files);
  });
  if (!zone) return;
  zone.addEventListener("dragover", (e) => {
    if (!selectedId) return;
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    if (!selectedId) return;
    e.preventDefault();
    zone.classList.remove("drag");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) setStills(kind, e.dataTransfer.files);
  });
}

bindStillInput(els.photoInput, els.uploadZone, "person");
bindStillInput(els.propInput, els.propZone, "prop");

els.refresh.addEventListener("click", () => loadCatalog());
window.addEventListener("scroll", syncPlayback, { passive: true });
window.addEventListener("resize", syncPlayback);
els.rail.addEventListener("scroll", syncPlayback, { passive: true });

function openHowto() {
  if (typeof els.howtoDialog.showModal === "function") els.howtoDialog.showModal();
  else els.howtoDialog.setAttribute("open", "");
}
function closeHowto() {
  if (typeof els.howtoDialog.close === "function") els.howtoDialog.close();
  else els.howtoDialog.removeAttribute("open");
  els.howtoBtn.focus();
}
els.howtoBtn.addEventListener("click", openHowto);
els.howtoClose.addEventListener("click", closeHowto);
els.howtoDialog.addEventListener("click", (e) => {
  if (e.target === els.howtoDialog) closeHowto();
});
els.extendTarget.addEventListener("input", () => {
  els.extendTargetVal.textContent = `${els.extendTarget.value}s`;
});

function setBusy(msg) {
  els.genStatus.textContent = msg || "";
  els.btnGen.disabled = true;
  els.btnExtend.disabled = true;
  els.btnAuto.disabled = true;
}

function clearBusy() {
  updateGenerateEnabled();
  els.btnExtend.disabled = false;
  els.btnAuto.disabled = false;
}

function showResult(fileOrUrl) {
  let url = fileOrUrl;
  if (fileOrUrl && typeof fileOrUrl === "object") {
    const nested = fileOrUrl.video && typeof fileOrUrl.video === "object" ? fileOrUrl.video : null;
    url = (nested && (nested.url || nested.path)) || fileOrUrl.url || fileOrUrl.path || fileOrUrl;
  }
  if (!url || typeof url !== "string") throw new Error("No video returned");
  url = rewriteSpaceVideoUrl(url, SPACE);
  lastResultUrl = url;
  els.resultPanel.hidden = false;
  els.resultVideo.src = lastResultUrl;
  els.resultVideo.play().catch(() => {});
  els.btnDownload.href = lastResultUrl;
  lastResultBlob = null;
}

async function resultFile() {
  if (!lastResultBlob) {
    const res = await fetch(lastResultUrl);
    if (!res.ok) throw new Error(`Video HTTP ${res.status}`);
    lastResultBlob = await res.blob();
  }
  return new File([lastResultBlob], "become-the-character.mp4", { type: "video/mp4" });
}

/** iPhone: the share sheet offers "Save Video" to Photos. Elsewhere: download. */
els.btnSave?.addEventListener("click", async () => {
  if (!lastResultUrl) return;
  try {
    const file = await resultFile();
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Become the Character" });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  } catch (e) {
    if (e && e.name === "AbortError") return;
    console.error(e);
    els.btnDownload.click();
  }
});

function statusText(value, fallback) {
  if (value == null || value === "") return fallback;
  return String(value).replace(/[*`]/g, "");
}

function rememberSession(data) {
  if (!data) return;
  if (Array.isArray(data) && data[4]) {
    sessionId = String(data[4]);
    return;
  }
  const sid = data.session_id || (typeof data.state === "string" ? data.state : "");
  if (sid) sessionId = String(sid);
}

function closeBitmaps(bitmaps) {
  for (const bitmap of bitmaps) {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

async function canvasToJpeg(canvas, name) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) return null;
  return new File([blob], name, { type: "image/jpeg" });
}

function drawContained(ctx, bitmap, x, y, w, h) {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = Math.max(1, Math.round(bitmap.width * scale));
  const dh = Math.max(1, Math.round(bitmap.height * scale));
  ctx.drawImage(bitmap, x + Math.round((w - dw) / 2), y + Math.round((h - dh) / 2), dw, dh);
}

/**
 * Phone stills (including HEIC) are re-encoded to JPEG.
 * Person stills are letterboxed (padded, never cropped) to the motion clip's
 * aspect. Several person stills sit side by side in that frame.
 */
async function personStillForUpload(files, target) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return null;
  let bitmaps = [];
  try {
    bitmaps = await Promise.all(list.map((file) => createImageBitmap(file)));
    const aspect = target ? target.width / target.height : bitmaps[0].width / bitmaps[0].height;
    const maxEdge = 1280;
    let cw;
    let ch;
    if (bitmaps.length === 1) {
      const bitmap = bitmaps[0];
      if (bitmap.width / bitmap.height > aspect) {
        cw = bitmap.width;
        ch = Math.round(bitmap.width / aspect);
      } else {
        ch = bitmap.height;
        cw = Math.round(bitmap.height * aspect);
      }
    } else {
      const cellW = Math.max(...bitmaps.map((bitmap) => bitmap.width));
      const cellH = Math.max(...bitmaps.map((bitmap) => bitmap.height));
      cw = cellW * bitmaps.length;
      ch = Math.round(cw / aspect);
      if (ch < cellH) {
        ch = cellH;
        cw = Math.round(ch * aspect);
      }
    }
    const scale = Math.min(1, maxEdge / Math.max(cw, ch));
    const width = Math.max(1, Math.round(cw * scale));
    const height = Math.max(1, Math.round(ch * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const cellW = width / bitmaps.length;
    bitmaps.forEach((bitmap, index) => drawContained(ctx, bitmap, cellW * index, 0, cellW, height));
    return (await canvasToJpeg(canvas, "person.jpg")) || list[0];
  } catch {
    return list[0];
  } finally {
    closeBitmaps(bitmaps);
  }
}

/** Prop stills stay in their own frame, side by side when there is more than one. */
async function propStillForUpload(files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return null;
  let bitmaps = [];
  try {
    bitmaps = await Promise.all(list.map((file) => createImageBitmap(file)));
    const maxH = 720;
    const scaled = bitmaps.map((bitmap) => {
      const fit = Math.min(1, maxH / bitmap.height, 1280 / bitmap.width);
      return {
        bitmap,
        w: Math.max(1, Math.round(bitmap.width * fit)),
        h: Math.max(1, Math.round(bitmap.height * fit)),
      };
    });
    let width = scaled.reduce((sum, item) => sum + item.w, 0);
    let height = Math.max(...scaled.map((item) => item.h));
    const down = Math.min(1, 1280 / width, 1280 / height);
    width = Math.max(1, Math.round(width * down));
    height = Math.max(1, Math.round(height * down));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    let x = 0;
    for (const item of scaled) {
      const w = Math.max(1, Math.round(item.w * down));
      const h = Math.max(1, Math.round(item.h * down));
      ctx.drawImage(item.bitmap, x, Math.round((height - h) / 2), w, h);
      x += w;
    }
    return (await canvasToJpeg(canvas, "prop.jpg")) || list[0];
  } catch {
    return list[0];
  } finally {
    closeBitmaps(bitmaps);
  }
}

/** Non-proxy fallback: the Space only accepts one image, so inset the prop here too. */
async function insetPropFile(personFile, propFile) {
  if (!personFile || !propFile) return personFile;
  let person = null;
  let prop = null;
  try {
    person = await createImageBitmap(personFile);
    prop = await createImageBitmap(propFile);
    const canvas = document.createElement("canvas");
    canvas.width = person.width;
    canvas.height = person.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(person, 0, 0);
    const margin = Math.max(4, Math.round(person.width * 0.04));
    const border = 3;
    const maxW = Math.max(1, Math.round(person.width * 0.34) - border * 2);
    const maxH = Math.max(1, Math.round(person.height * 0.28) - border * 2);
    const scale = Math.min(maxW / prop.width, maxH / prop.height);
    const dw = Math.max(1, Math.round(prop.width * scale));
    const dh = Math.max(1, Math.round(prop.height * scale));
    const x = person.width - margin - border - dw;
    const y = person.height - margin - border - dh;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - border, y - border, dw + border * 2, dh + border * 2);
    ctx.drawImage(prop, x, y, dw, dh);
    return (await canvasToJpeg(canvas, "reference.jpg")) || personFile;
  } catch {
    return personFile;
  } finally {
    if (person && typeof person.close === "function") person.close();
    if (prop && typeof prop.close === "function") prop.close();
  }
}

function generateArgs(size) {
  const selected = templates.find((t) => t.id === selectedId);
  const target = workerSize(size);
  return {
    template_id: selectedId,
    video_url: selected ? videoUrl(selected) : "",
    prompt: els.prompt.value.trim() || (propPoints.length ? MIX_PROP_PROMPT : MIX_DEFAULT_PROMPT),
    template_width: size ? size.width : undefined,
    template_height: size ? size.height : undefined,
    frame_width: frameNatural.width || undefined,
    frame_height: frameNatural.height || undefined,
    orientation: target.width > target.height ? "landscape" : target.width < target.height ? "portrait" : "square",
    max_seconds: 3,
    height: target.height,
    width: target.width,
    steps: 10,
    guidance: 2,
    cfg: 2,
    sample_shift: 5,
    negative: "",
    seed: Math.floor(Math.random() * 1_000_000_000),
    mode: "replace",
    positive_points: positivePoints,
    prop_points: propPoints,
    session_id: sessionId || "",
  };
}

function extendArgs(auto) {
  const args = {
    prompt: els.prompt.value,
    seg_duration: 3.5,
    steps: 4,
    negative: "",
    seed: 42,
    randomize: true,
    quality: 6,
    fps: 16,
    safe_mode: true,
    session_id: sessionId,
  };
  if (auto) args.target_seconds = Number(els.extendTarget.value);
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Netlify starts the Wan run in the background and the page polls /api/job. */
async function pollJob(jobId, apiName) {
  const extend = apiName === "/extend" || apiName === "/auto_extend";
  const wait = extend ? EXTEND_WAIT : GENERATE_WAIT;
  const queued = extend ? `Queued on the Space… ${wait}` : `Queued on Runpod… ${wait}`;
  const running = extend ? `Extending on the Space… ${wait}` : `Running Wan Animate on Runpod… ${wait}`;
  const started = Date.now();
  const limit = 14 * 60 * 1000;
  while (Date.now() - started < limit) {
    await sleep(2500);
    const res = await fetch(`/api/job?id=${encodeURIComponent(jobId)}`);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status === 404) {
      els.genStatus.textContent = queued;
      continue;
    }
    if (!res.ok) {
      throw new Error(publicErrorText((data && data.error) || text || `Job HTTP ${res.status}`));
    }
    if (data?.phase === "done") return data;
    if (data?.phase === "error") throw new Error(publicErrorText(data.error || "Generate failed"));
    els.genStatus.textContent = data?.phase === "running" ? running : queued;
  }
  throw new Error(
    extend
      ? "Timed out waiting for Extend. The Space can take several minutes. Wait a minute and try once."
      : "Timed out waiting for Generate. The first Runpod run can take several minutes while the worker starts. Wait a minute and try once."
  );
}

/** Same-origin proxy. Used for generate, extend, and auto_extend when USE_PROXY is true. */
async function callSpace(apiName, payload) {
  const form = new FormData();
  form.append("api", apiName);
  form.append("payload", JSON.stringify(payload.json || {}));
  if (payload.photo) {
    const photo = payload.prepared ? payload.photo : await personStillForUpload([payload.photo], payload.target);
    if (photo) form.append("photo", photo, photo.name || "person.jpg");
  }
  if (payload.propPhoto) {
    form.append("prop_photo", payload.propPhoto, payload.propPhoto.name || "prop.jpg");
  }
  const res = await fetch("/api/generate", { method: "POST", body: form });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(publicErrorText((data && data.error) || text || `Proxy HTTP ${res.status}`));
  }
  if (!data) throw new Error(publicErrorText(text || "Proxy returned an empty response"));
  if (data.phase === "error") throw new Error(publicErrorText(data.error || "Generate failed"));
  if (data.phase === "queued" || data.phase === "running") {
    if (!data.job_id) throw new Error("Generate did not return a job id");
    if (apiName === "/generate") currentRunpodJob = data.job_id;
    try {
      return await pollJob(data.job_id, apiName);
    } finally {
      if (apiName === "/generate") currentRunpodJob = "";
    }
  }
  return data;
}

els.maskModePerson?.addEventListener("click", () => setMaskMode("person"));
els.maskModeProp?.addEventListener("click", () => setMaskMode("prop"));
els.maskClear?.addEventListener("click", () => clearMaskPoints());
els.maskCanvas?.addEventListener("pointerdown", onMaskPointer);
window.addEventListener("resize", () => drawMaskCanvas());

els.btnGen.addEventListener("click", async () => {
  const blocked = generateBlockReason();
  if (blocked) {
    if (els.gateHint) els.gateHint.textContent = blocked;
    return;
  }
  setBusy(`Queuing Mix on Runpod… ${GENERATE_WAIT}`);
  try {
    const size = await templateSize(templates.find((t) => t.id === selectedId));
    const target = workerSize(size);
    const personStill = await personStillForUpload(personFiles, target);
    const propStill = propFiles.length ? await propStillForUpload(propFiles) : null;
    if (!personStill) throw new Error("Could not read the person still.");
    if (propFiles.length && !propStill) throw new Error("Could not read the prop still.");
    const args = generateArgs(size);
    if (USE_PROXY) {
      const data = await callSpace("/generate", {
        json: args,
        photo: personStill,
        propPhoto: propStill,
        prepared: true,
        target,
      });
      rememberSession(data);
      showResult(data.video || data.url);
      els.genStatus.textContent = statusText(data.status, "Done.");
    } else {
      const { Client } = await import("@gradio/client");
      const client = await Client.connect(SPACE);
      const image = await insetPropFile(personStill, propStill);
      const result = await client.predict("/generate", { ...args, image });
      // result.data: [video, download, status, last_frame, session_id]
      const data = result?.data || result;
      const video = Array.isArray(data) ? data[0] : data;
      rememberSession(data);
      showResult(video);
      els.genStatus.textContent = statusText(Array.isArray(data) ? data[2] : null, "Done.");
    }
  } catch (e) {
    console.error(e);
    const hint = USE_PROXY
      ? ""
      : " If CORS blocked, set window.CONFIG.USE_PROXY = true and redeploy.";
    els.genStatus.textContent = `Generate failed: ${generateFailureText(e)}.${hint}`;
  } finally {
    clearBusy();
  }
});

async function extendOnce(auto) {
  if (!lastResultUrl) {
    els.genStatus.textContent = "Generate a clip first.";
    return;
  }
  setBusy(auto ? `Auto-extending on the Space… ${EXTEND_WAIT}` : `Extending on the Space… ${EXTEND_WAIT}`);
  try {
    const api = auto ? "/auto_extend" : "/extend";
    if (!sessionId) {
      throw new Error(
        lastResultUrl && String(lastResultUrl).startsWith("/api/result")
          ? "Extend uses the Hugging Face Space and cannot continue a Runpod clip."
          : "Missing session_id — generate first in this browser session."
      );
    }
    const args = extendArgs(auto);
    if (USE_PROXY) {
      const data = await callSpace(api, { json: args });
      rememberSession(data);
      showResult(data.video || data.url);
      els.genStatus.textContent = statusText(data.status, "Extended.");
    } else {
      const { Client } = await import("@gradio/client");
      const client = await Client.connect(SPACE);
      const result = await client.predict(api, args);
      const data = result?.data || result;
      const video = Array.isArray(data) ? data[0] : data;
      rememberSession(data);
      showResult(video);
      els.genStatus.textContent = statusText(Array.isArray(data) ? data[2] : null, "Extended.");
    }
  } catch (e) {
    console.error(e);
    els.genStatus.textContent = `Extend failed: ${publicErrorText(e)}`;
  } finally {
    clearBusy();
  }
}

els.btnExtend.addEventListener("click", () => extendOnce(false));
els.btnAuto.addEventListener("click", () => extendOnce(true));

async function refreshBalance() {
  if (!els.balance) return;
  try {
    const res = await fetch("/api/balance", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || typeof data.balance !== "number") throw new Error(data.error || `HTTP ${res.status}`);
    const spend = typeof data.spendPerHour === "number" ? ` · $${data.spendPerHour.toFixed(3)}/hr` : "";
    els.balance.textContent = `Runpod balance $${data.balance.toFixed(2)}${spend}`;
  } catch (e) {
    els.balance.textContent = `Runpod balance unavailable (${e.message})`;
  }
}

els.btnStop?.addEventListener("click", async () => {
  els.btnStop.disabled = true;
  els.stopStatus.textContent = "Stopping Runpod GPU…";
  try {
    const res = await fetch("/api/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: currentRunpodJob }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const w = data.health?.workers || {};
    const j = data.health?.jobs || {};
    els.stopStatus.textContent = `${data.steps.join(" · ")}. Now: ${w.running ?? 0} running, ${w.idle ?? 0} idle workers, ${j.inQueue ?? 0} queued, ${j.inProgress ?? 0} in progress.`;
  } catch (e) {
    els.stopStatus.textContent = `Stop failed: ${e.message}`;
  } finally {
    els.btnStop.disabled = false;
    refreshBalance();
  }
});

if (els.prompt) {
  const current = els.prompt.value.trim();
  if (!current || LEGACY_KEEP_PROMPTS.includes(current)) els.prompt.value = MIX_PROP_PROMPT;
}
refreshBalance();
setInterval(refreshBalance, 30000);
updateGenerateEnabled();
loadCatalog();
