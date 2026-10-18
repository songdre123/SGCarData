// SG Car Data — News Admin (password-gated, in-browser CRUD)
const $ = (id) => document.getElementById(id);

// SHA-256 of the admin password (default: "changeme"). Change this hash to change the password.
const PASSWORD_HASH = "057ba03d6c44104863dc7361fe4578965d1887360f90a0895882e58a6248fc86";

const GATE = $("gate"), ADMIN = $("admin");
const PASS_KEY = "sgcaradmin_ok";

async function sha256(msg) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkPassword() {
  const entered = $("adminPass").value.trim();
  if (!entered) { $("gateError").textContent = "Enter a password."; return false; }
  const h = await sha256(entered);
  if (h === PASSWORD_HASH) {
    localStorage.setItem(PASS_KEY, "1");
    $("adminPass").value = "";
    showAdmin();
    return true;
  }
  $("gateError").textContent = "Wrong password.";
  return false;
}

function showAdmin() {
  GATE.style.display = "none";
  ADMIN.style.display = "block";
  loadNews();
}

$("loginBtn").addEventListener("click", checkPassword);
$("adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") checkPassword(); });
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(PASS_KEY);
  ADMIN.style.display = "none";
  GATE.style.display = "block";
});

// Restore session
if (localStorage.getItem(PASS_KEY) === "1") {
  showAdmin();
}

// ---- News CRUD ----
let NEWS = [];

async function loadNews() {
  try {
    const data = await (await fetch("data/news.json")).json();
    NEWS = data.items || [];
  } catch (e) {
    NEWS = [];
  }
  renderNews();
}

function renderNews() {
  const tbody = $("newsAdminList");
  tbody.innerHTML = "";
  const sorted = [...NEWS].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  sorted.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(item.date || "")}</td>
      <td>${esc(item.title || "")}<div class="news-meta">${esc(item.source || "")}${item.url ? ' · <a href="' + item.url + '" target="_blank">link</a>' : ""}</div></td>
      <td>${esc(item.source || "")}</td>
      <td>
        <button class="btn ghost" data-act="edit" data-i="${i}">Edit</button>
        <button class="btn ghost" data-act="del" data-i="${i}" style="color:#e74c3c">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
  if ($("itemCount")) $("itemCount").textContent = `${NEWS.length} items`;
  tbody.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const i = +b.dataset.i;
      if (b.dataset.act === "del") deleteItem(i);
      else editItem(i);
    });
  });
}

function deleteItem(i) {
  if (!confirm("Delete this news item?")) return;
  NEWS.splice(i, 1);
  renderNews();
}

function editItem(i) {
  const item = NEWS[i];
  $("nTitle").value = item.title || "";
  $("nSource").value = item.source || "";
  $("nDate").value = item.date || "";
  $("nUrl").value = item.url || "";
  $("nImage").value = item.image || "";
  $("nSummary").value = item.summary || "";
  $("nTitle").focus();
  window._editing = i;
}

function clearForm() {
  $("newsForm").reset();
  window._editing = null;
}

$("newsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = {
    title: $("nTitle").value.trim(),
    source: $("nSource").value.trim(),
    date: $("nDate").value,
    url: $("nUrl").value.trim(),
    image: $("nImage").value.trim(),
    summary: $("nSummary").value.trim(),
  };
  if (window._editing != null) {
    NEWS[window._editing] = item;
  } else {
    NEWS.push(item);
  }
  clearForm();
  renderNews();
});

$("clearBtn").addEventListener("click", clearForm);

// Upload news.json from local file
$("uploadFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data && Array.isArray(data.items)) {
        NEWS = data.items;
        renderNews();
        alert("Loaded " + NEWS.length + " items from file. Click Download to save to site/data/news.json.");
      } else {
        alert("Invalid file — expected {\"items\": [...]}");
      }
    } catch (err) {
      alert("Could not parse JSON: " + err.message);
    }
  };
  reader.readAsText(file);
  $("uploadFile").value = "";
});

function downloadNews() {
  const blob = new Blob([JSON.stringify({ items: NEWS }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "news.json";
  a.click();
  URL.revokeObjectURL(url);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Expose save action to admin page buttons (add a Save/Download button via DOM)
const saveBtn = document.createElement("button");
saveBtn.className = "btn";
saveBtn.textContent = "Download news.json";
saveBtn.style.marginLeft = "auto";
saveBtn.addEventListener("click", downloadNews);
$("admin").appendChild(saveBtn);