/* ডাকদাও — frontend (talks to server.js API) */

const bnDigits = "০১২৩৪৫৬৭৮৯";
const bn = n => String(n).replace(/\d/g, d => bnDigits[d]);
const tk = n => "৳" + bn(Number(n).toLocaleString("en-IN"));
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let res;
  try { res = await fetch(path, opt); }
  catch { throw new Error("সার্ভারে সংযোগ করা যাচ্ছে না"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "কিছু একটা ভুল হয়েছে"); e.status = res.status; throw e; }
  return data;
}

function timeAgo(t){
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "এইমাত্র";
  const m = Math.floor(s/60); if (m < 60) return bn(m) + " মিনিট আগে";
  const h = Math.floor(m/60); if (h < 24) return bn(h) + " ঘণ্টা আগে";
  return bn(Math.floor(h/24)) + " দিন আগে";
}
function duration(t){
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = s%60;
  return `${bn(h)} ঘণ্টা ${bn(m)} মিনিট ${bn(sec)} সেকেন্ড`;
}
function toast(t){ $("toast").textContent = t; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 1800); }

/* ---------- public state ---------- */
let state = { king: null, history: [], minNext: 0, bank: {} };

async function loadState(){
  try { state = await api("/api/state"); render(); }
  catch (e) { $("kMsg").textContent = e.message; }
}
function render(){
  const k = state.king;
  if (k){
    $("kMsg").textContent = k.msg;
    $("kName").textContent = "— " + k.name;
    $("kAmt").textContent = tk(k.amount);
  } else {
    $("kMsg").textContent = "সিংহাসন খালি! প্রথম রাজা তুমিই হও।";
    $("kName").textContent = "";
    $("kAmt").textContent = tk(0);
    $("kTime").textContent = "";
  }
  $("minNext").textContent = tk(state.minNext);
  $("history").innerHTML = state.history.length ? state.history.map(b => `
    <li><div><div class="m">${esc(b.msg)}</div><div class="n">${esc(b.name)} · ${timeAgo(b.time)}</div></div>
    <div class="a">${tk(b.amount)}</div></li>`).join("")
    : `<li class="empty">এখনো কেউ নেই</li>`;
}
setInterval(() => { if (state.king) $("kTime").textContent = "⏱ রাজত্ব চলছে " + duration(state.king.time); }, 1000);
setInterval(() => { if (!document.hidden) { loadState(); loadMyBids(); } }, 10000);

/* ---------- my bids (refs kept in this browser) ---------- */
const STATUS = { unpaid: "পেমেন্ট বাকি", pending: "যাচাই চলছে", approved: "অনুমোদিত ✓", rejected: "বাতিল" };
const myRefs = () => JSON.parse(localStorage.getItem("dakdao_refs") || "[]");
const saveRef = ref => localStorage.setItem("dakdao_refs", JSON.stringify([ref, ...myRefs().filter(r => r !== ref)].slice(0, 20)));

async function loadMyBids(){
  const refs = myRefs();
  if (!refs.length) return $("myBidsCard").classList.add("hidden");
  const bids = (await Promise.all(refs.map(r => api("/api/bids/" + r).catch(() => null)))).filter(Boolean);
  $("myBidsCard").classList.toggle("hidden", !bids.length);
  $("myBids").innerHTML = bids.map(b => `
    <li><div><div class="m">${esc(b.msg)}</div>
      <div class="n">রেফ: ${esc(b.ref)} · <span class="badge st-${b.status}">${STATUS[b.status] || b.status}</span>
      ${b.status === "unpaid" ? ` · <a href="#" data-resume="${esc(b.ref)}" data-amt="${b.amount}">পেমেন্ট সম্পন্ন করো →</a>` : ""}</div></div>
    <div class="a">${tk(b.amount)}</div></li>`).join("");
}
$("myBids").addEventListener("click", e => {
  const ref = e.target.dataset.resume;
  if (!ref) return;
  e.preventDefault();
  openPayment(ref, Number(e.target.dataset.amt), state.bank);
  $("overlay").classList.add("show");
});

/* ---------- bid modal ---------- */
let currentRef = null;
function showStep(n){
  [1,2,3].forEach(i => { $("step"+i).classList.toggle("hidden", i!==n); $("s"+i).classList.toggle("on", i<=n); });
}
function openPayment(ref, amount, bank){
  currentRef = ref;
  $("payAmt").textContent = tk(amount);
  $("refCode").textContent = ref;
  $("bankBox").innerHTML = Object.entries(bank).map(([k,v],i) =>
    `<div class="bank-row"><span>${esc(k)}</span><b><span id="bk${i}">${esc(v)}</span><button class="copy" data-copy="bk${i}">কপি</button></b></div>`).join("");
  $("err2").textContent = "";
  showStep(2);
}
$("openBid").onclick = async () => {
  await loadState();
  $("fAmt").value = bn(state.minNext);
  $("err1").textContent = $("err2").textContent = "";
  showStep(1); $("overlay").classList.add("show");
};
$("closeModal").onclick = $("doneBtn").onclick = () => { $("overlay").classList.remove("show"); loadMyBids(); };
$("fMsg").oninput = () => $("msgCount").textContent = bn($("fMsg").value.length);

async function withBusy(btn, fn){
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

$("toStep2").onclick = () => withBusy($("toStep2"), async () => {
  const name = $("fName").value.trim(), msg = $("fMsg").value.trim(), amount = $("fAmt").value.trim();
  if (!name) return $("err1").textContent = "নাম লেখো";
  if (!msg) return $("err1").textContent = "একটা বার্তা লেখো";
  try {
    const r = await api("/api/bids", { name, msg, amount });
    saveRef(r.ref);
    openPayment(r.ref, r.amount, r.bank);
  } catch (e) { $("err1").textContent = bn(e.message); }
});
$("back1").onclick = () => showStep(1);

$("submitBid").onclick = () => withBusy($("submitBid"), async () => {
  const trx = $("fTrx").value.trim(), from = $("fFrom").value.trim();
  if (trx.length < 4) return $("err2").textContent = "সঠিক ট্রানজেকশন আইডি দাও";
  try {
    await api(`/api/bids/${currentRef}/payment`, { trx, from });
    ["fName","fMsg","fTrx","fFrom"].forEach(id => $(id).value = ""); $("msgCount").textContent = "০";
    showStep(3);
  } catch (e) { $("err2").textContent = e.message; }
});

document.addEventListener("click", e => {
  const id = e.target.dataset && e.target.dataset.copy;
  if (!id) return;
  navigator.clipboard.writeText($(id).textContent).then(() => toast("কপি হয়েছে"), () => toast("কপি করা যায়নি"));
});

/* ---------- nav ---------- */
function showView(v){
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x.dataset.view === v));
  $("view-home").classList.toggle("hidden", v !== "home");
  $("view-admin").classList.toggle("hidden", v !== "admin");
  if (v === "admin") renderPending(); else { loadState(); loadMyBids(); }
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => showView(b.dataset.view));

/* ---------- admin ---------- */
function setAdmin(logged){
  $("adminLogin").classList.toggle("hidden", logged);
  $("adminPanel").classList.toggle("hidden", !logged);
}
$("adminLoginBtn").onclick = () => withBusy($("adminLoginBtn"), async () => {
  try {
    await api("/api/admin/login", { password: $("adminPin").value });
    $("adminPin").value = ""; $("pinErr").textContent = "";
    renderPending();
  } catch (e) { $("pinErr").textContent = e.message; }
});
$("adminPin").onkeydown = e => { if (e.key === "Enter") $("adminLoginBtn").click(); };
$("logoutBtn").onclick = async () => { await api("/api/admin/logout", {}).catch(() => {}); setAdmin(false); };
$("refreshBtn").onclick = () => renderPending();

async function renderPending(){
  let data;
  try { data = await api("/api/admin/pending"); }
  catch (e) { if (e.status === 401) return setAdmin(false); return toast(e.message); }
  setAdmin(true);
  const p = data.pending;
  $("pendingList").innerHTML = p.length ? p.map(x => `
    <div class="pending">
      <div class="row"><b>${esc(x.name)}</b><b style="color:var(--gold)">${tk(x.amount)}</b></div>
      <div class="hint">"${esc(x.msg)}"</div>
      <div class="row"><span>ট্রানজেকশন: <b>${esc(x.trx)}</b></span><span class="badge">রেফ: ${esc(x.ref)}</span></div>
      <div class="row"><span>প্রেরকের অ্যাকাউন্ট: ****${bn(esc(x.from_last4))}</span><span class="n">${timeAgo(x.paid_at)}</span></div>
      ${x.amount <= data.kingAmount ? `<div class="err">⚠️ বর্তমান রাজার (${tk(data.kingAmount)}) চেয়ে কম/সমান — অনুমোদন করলে শুধু ইতিহাসে যাবে</div>` : ""}
      <div class="actions">
        <button class="btn ok" data-approve="${x.id}">✔ অনুমোদন</button>
        <button class="btn secondary" data-reject="${x.id}">✖ বাতিল</button>
      </div>
    </div>`).join("") : `<p class="empty">কোনো পেমেন্ট অপেক্ষায় নেই</p>`;
}
$("pendingList").addEventListener("click", async e => {
  const id = e.target.dataset.approve || e.target.dataset.reject;
  if (!id) return;
  const action = e.target.dataset.approve ? "approve" : "reject";
  if (action === "reject" && !confirm("এই পেমেন্ট বাতিল করবে?")) return;
  e.target.disabled = true;
  try {
    await api(`/api/admin/bids/${id}/${action}`, {});
    toast(action === "approve" ? "অনুমোদিত হয়েছে" : "বাতিল করা হয়েছে");
  } catch (err) { toast(err.message); }
  renderPending(); loadState();
});

/* ---------- start ---------- */
loadState();
loadMyBids();
if (location.pathname === "/admin") showView("admin");
