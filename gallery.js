// ══════════════════════════════════════════════════════════
//  Cahaya PhotoBooth — logika galeri
//
//  Menggantikan isi <script> di index.html.
//  Perubahan dibanding versi lama:
//   1. Event terbaru tampil duluan (dulu yang tampil justru event tertua).
//   2. Bisa cari foto lewat KODE SESI, dan otomatis terisi dari ?kode=XXXX
//      sehingga QR di layar booth langsung membuka foto yang tepat.
//   3. Password admin tidak lagi ditaruh di sini (dulu siapa pun bisa
//      membacanya lewat "view source"). Pengecekan pindah ke Apps Script.
// ══════════════════════════════════════════════════════════

// ──────────────────────────────────────────
// KONFIGURASI
// ──────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby1u_AtcGLCfaZMAwyLDmb_G76xxGLENxUQEqkZu4wHhf_KhcCS4NZtuNR-kaWpdAe_pA/exec";
const API_KEY    = "AIzaSyCTa5Vjz8IvcoMmyl4I-PZOlo-DiVSPygk";
const ADMIN_URL  = "admin.html";
// ──────────────────────────────────────────

let activeId = null, timer = null;
let lbSlide = 0, lbHasVideo = false;
let touchStartX = 0;
let allSessions = [];      // hasil terakhir dari Drive, sebelum difilter
let activeEvent = null;
let filterCode = "";       // kode sesi yang sedang dicari

// ── Init ──
async function init() {
  // Kode dari QR: cahayaphotobooth.netlify.app/?kode=CP-8F3K2
  const params = new URLSearchParams(location.search);
  filterCode = (params.get("kode") || params.get("code") || "").trim();
  const box = document.getElementById("search-input");
  if (box) box.value = filterCode;
  updateClearBtn();

  try {
    const res = await fetch(`${SCRIPT_URL}?action=getEvents`);
    const data = await res.json();
    const evs = (data.events || []).filter(e => e.visible);

    // Event terbaru duluan: yang paling relevan saat booth sedang jalan.
    evs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    document.getElementById("st-load").style.display = "none";
    if (!evs.length) { document.getElementById("st-noev").classList.add("show"); return; }
    document.getElementById("ebar").style.display = "flex";
    renderPills(evs);
    switchEv(evs[0], evs);
  } catch (e) {
    document.getElementById("st-load").innerHTML =
      `<p style="color:#e74c3c;font-size:13px">⚠️ Gagal memuat.<br><small style="color:var(--muted)">${e.message}</small></p>`;
  }
}

// ── Pills ──
function renderPills(evs) {
  const c = document.getElementById("pills"); c.innerHTML = "";
  evs.forEach(ev => {
    const p = document.createElement("button");
    p.className = "pill" + (ev.id === activeId ? " active" : "");
    p.textContent = ev.name;
    p.onclick = () => switchEv(ev, evs);
    c.appendChild(p);
  });
}

// ── Switch event ──
function switchEv(ev, evs) {
  activeId = ev.id; activeEvent = ev; renderPills(evs);
  document.getElementById("en").textContent = ev.name;
  document.getElementById("ed").textContent = ev.date || "";
  document.getElementById("gallery").innerHTML = "";
  document.getElementById("st-empty").classList.remove("show");
  document.getElementById("st-load").style.display = "block";
  document.getElementById("st-load").innerHTML = `<div class="spin"></div><p>Memuat...</p>`;
  if (timer) clearInterval(timer);
  loadFiles(ev);
  timer = setInterval(() => loadFiles(ev), 60000);
}

// ── Load files ──
async function loadFiles(ev) {
  try {
    // Catatan: 'folderId' in parents hanya membaca anak LANGSUNG folder,
    // jadi subfolder arsip/ dari aplikasi booth otomatis terabaikan.
    const url = `https://www.googleapis.com/drive/v3/files`
      + `?q='${ev.folderId}'+in+parents`
      + `+and+trashed=false`
      + `+and+(mimeType+contains+'image/'+or+mimeType+contains+'video/')`
      + `&orderBy=createdTime+desc`
      + `&fields=files(id,name,mimeType,createdTime,thumbnailLink)`
      + `&pageSize=1000&key=${API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API Error ${res.status}`);
    const data = await res.json();

    document.getElementById("st-load").style.display = "none";
    if (!data.files || !data.files.length) {
      allSessions = [];
      document.getElementById("st-empty").classList.add("show");
      document.getElementById("cnt").textContent = "0";
      return;
    }

    const photos = data.files.filter(f => f.mimeType.startsWith("image/"));
    const videos = data.files.filter(f => f.mimeType.startsWith("video/"));
    allSessions = pairFiles(photos, videos);
    applyFilter();
  } catch (e) {
    document.getElementById("st-load").innerHTML =
      `<p style="color:#e74c3c;font-size:13px">⚠️ ${e.message}</p>`;
  }
}

// ── Pair foto & video (nama dasar sama) ──
function pairFiles(photos, videos) {
  const vmap = {};
  videos.forEach(v => { vmap[baseName(v.name)] = v; });
  const sessions = photos.map(p => ({
    photo: p,
    video: vmap[baseName(p.name)] || null,
    code: baseName(p.name).toUpperCase(),
    createdTime: p.createdTime
  }));
  sessions.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  return sessions;
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, "").toLowerCase();
}

// ── Filter berdasarkan kode sesi ──
function applyFilter() {
  const q = filterCode.trim().toLowerCase();
  const list = q
    ? allSessions.filter(s => s.code.toLowerCase().includes(q))
    : allSessions;

  document.getElementById("cnt").textContent = list.length;
  document.getElementById("st-empty").classList.remove("show");

  const hint = document.getElementById("search-hint");
  if (q) {
    hint.style.display = "block";
    hint.innerHTML = list.length
      ? `Menampilkan <b>${list.length}</b> foto dengan kode <b>${escapeHtml(filterCode)}</b>`
      : `Tidak ada foto dengan kode <b>${escapeHtml(filterCode)}</b> di event ini. Coba pilih event lain di atas.`;
  } else {
    hint.style.display = "none";
  }

  if (!list.length && !q) {
    document.getElementById("st-empty").classList.add("show");
    document.getElementById("gallery").innerHTML = "";
    return;
  }
  renderGallery(list, activeEvent);

  // Kalau QR mengarah ke satu foto saja, langsung buka besarnya.
  if (q && list.length === 1 && !window.__openedFromCode) {
    window.__openedFromCode = true;
    const s = list[0];
    setTimeout(() => openLB(thumbOf(s), dlOf(s.photo), s.video ? dlOf(s.video) : "",
      waOf(s, activeEvent), s.video ? s.video.id : ""), 350);
  }
}

function onSearchInput(v) {
  filterCode = v;
  window.__openedFromCode = true; // jangan auto-buka saat user mengetik manual
  updateClearBtn();
  applyFilter();
}

function clearSearch() {
  filterCode = "";
  const box = document.getElementById("search-input");
  if (box) box.value = "";
  updateClearBtn();
  applyFilter();
}

function updateClearBtn() {
  const b = document.getElementById("search-clear");
  if (b) b.style.display = filterCode ? "block" : "none";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Helper link ──
function thumbOf(s) {
  return s.photo.thumbnailLink
    ? s.photo.thumbnailLink.replace("=s220", "=s600")
    : `https://drive.google.com/thumbnail?id=${s.photo.id}&sz=w600`;
}
function dlOf(f) { return `https://drive.google.com/uc?export=download&id=${f.id}`; }
function waOf(s, ev) {
  const view = `https://drive.google.com/file/d/${s.photo.id}/view`;
  const nama = ev ? ev.name : "photo booth";
  return `https://wa.me/?text=${encodeURIComponent(`Lihat foto saya dari ${nama}! 📸\n${view}`)}`;
}

// ── Render gallery ──
function renderGallery(sessions, ev) {
  const g = document.getElementById("gallery"); g.innerHTML = "";
  const now = Date.now();

  sessions.forEach((s, i) => {
    const cr = new Date(s.createdTime);
    const isNew = (now - cr.getTime()) < 30 * 60 * 1000;
    const ts = cr.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const ds = cr.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
    const thumb = thumbOf(s);
    const dlp = dlOf(s.photo);
    const dlv = s.video ? dlOf(s.video) : "";
    const wa = waOf(s, ev);
    const vid = s.video ? s.video.id : "";
    const showCode = /^CP-/i.test(s.code);

    const c = document.createElement("div");
    c.className = "pc";
    c.style.animationDelay = `${Math.min(i, 20) * 0.035}s`;
    c.innerHTML = `
      <div class="thumb" onclick="openLB('${thumb}','${dlp}','${dlv}','${wa}','${vid}')">
        <img src="${thumb}" loading="lazy" alt="">
        ${isNew ? '<div class="nb">Baru</div>' : ''}
        ${showCode ? `<div class="cb">${escapeHtml(s.code)}</div>` : ''}
        ${s.video ? '<div class="vb"><span class="vb-play"></span>GIF</div>' : ''}
      </div>
      <div class="cf">
        <span class="ct">🕐 ${ts} · ${ds}</span>
        <div class="ca">
          <a class="btn-dl" href="${dlp}" download onclick="event.stopPropagation()">⬇</a>
          <a class="btn-dl btn-wa" href="${wa}" target="_blank" onclick="event.stopPropagation()">📢</a>
        </div>
      </div>`;
    g.appendChild(c);
  });
}

// ── Lightbox ──
function openLB(thumb, dlp, dlv, wa, vidId) {
  lbSlide = 0;
  lbHasVideo = !!vidId;
  document.getElementById("lb-img").src = thumb;
  document.getElementById("lb-dl").href = dlp;
  document.getElementById("lb-wa").href = wa;
  if (vidId) {
    document.getElementById("lb-vid").src = `https://drive.google.com/uc?export=download&id=${vidId}`;
    document.getElementById("lb-dlv").href = dlv;
    document.getElementById("lb-dlv").classList.remove("hide");
  } else {
    document.getElementById("lb-vid").src = "";
    document.getElementById("lb-dlv").classList.add("hide");
  }
  document.getElementById("arr-l").style.display = lbHasVideo ? "flex" : "none";
  document.getElementById("arr-r").style.display = lbHasVideo ? "flex" : "none";
  renderDots(); goSlide(0);
  document.getElementById("lb").classList.add("open");
}

function renderDots() {
  const dots = document.getElementById("lb-dots");
  dots.innerHTML = "";
  if (!lbHasVideo) { dots.style.display = "none"; return; }
  dots.style.display = "flex";
  ["Foto", "Video"].forEach((_, i) => {
    const d = document.createElement("div");
    d.className = "lb-dot" + (i === lbSlide ? " active" : "");
    d.onclick = () => goSlide(i);
    dots.appendChild(d);
  });
}

function goSlide(idx) {
  lbSlide = idx;
  const vid = document.getElementById("lb-vid");
  document.getElementById("sl-0").classList.toggle("active", idx === 0);
  document.getElementById("sl-1").classList.toggle("active", idx === 1);
  idx === 1 ? vid.play().catch(() => {}) : vid.pause();
  document.querySelectorAll(".lb-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
}

function slideNav(dir) {
  if (!lbHasVideo) return;
  goSlide((lbSlide + dir + 2) % 2);
}

function closeLB() {
  document.getElementById("lb").classList.remove("open");
  document.getElementById("lb-vid").pause();
  document.getElementById("lb-vid").src = "";
}

document.getElementById("lb").addEventListener("click", e => {
  if (e.target === document.getElementById("lb")) closeLB();
});
document.addEventListener("keydown", e => {
  if (!document.getElementById("lb").classList.contains("open")) return;
  if (e.key === "Escape") closeLB();
  if (e.key === "ArrowLeft") slideNav(-1);
  if (e.key === "ArrowRight") slideNav(1);
});
document.getElementById("lb").addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.getElementById("lb").addEventListener("touchend", e => {
  const diff = touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 50) slideNav(diff > 0 ? 1 : -1);
});

// ── Admin ──
// Password sekarang diperiksa di Apps Script, bukan di halaman ini.
function goAdmin() { window.location.href = ADMIN_URL; }

init();
