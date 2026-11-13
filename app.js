import { buildSession, markIndexAt, encodeWav } from "./audio.js?v=5";
import { getWav, selfTest, clearCache, cacheSize, setStatusHandler } from "./tts.js?v=5";

// ---------- words ----------
let BASE = [];
const KEY = "eng-vocab-trainer-v1";
const S = {
  known: {}, removed: {}, custom: [], sel: {}, dir: "en2he", tab: "cards", auto: false,
  listen: { pause: 1, gap: 2, shuf: false, mode2: "wav", rate: 0.9, voiceHe: "", voiceEn: "", enEngine: "kokoro", kvoice: "af_heart", heMode: "none" }
};
try {
  const sv = JSON.parse(localStorage.getItem(KEY) || "null");
  if (sv) {
    S.known = sv.known || {}; S.removed = sv.removed || {}; S.custom = sv.custom || [];
    S.sel = sv.sel || {}; S.dir = sv.dir || S.dir; S.tab = sv.tab || S.tab; S.auto = !!sv.auto;
    if (sv.listen) Object.assign(S.listen, sv.listen);
  }
} catch (e) {}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}

let WORDS = [], BYID = {};
function rebuildWords() {
  const base = BASE.map((r) => ({ id: r.lesson + ":" + r.en, lesson: r.lesson, en: r.en, he: r.he, ex: r.ex || "", v: !!r.v, custom: false }));
  const custom = S.custom.map((r) => ({ id: r.id, lesson: r.lesson, en: r.en, he: r.he, ex: r.ex || "", v: false, custom: true }));
  WORDS = base.filter((w) => !S.removed[w.id]).concat(custom);
  BYID = {};
  WORDS.forEach((w) => { BYID[w.id] = w; });
}
function lessons() {
  const set = {};
  WORDS.forEach((w) => { set[w.lesson] = 1; });
  return Object.keys(set).map(Number).sort((a, b) => a - b);
}
const lessonOn = (l) => S.sel[l] !== 0;
const selected = () => WORDS.filter((w) => lessonOn(w.lesson));
const pool = () => selected().filter((w) => !S.known[w.id]);

// ---------- helpers ----------
const q = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
let toastTimer = null;
function toast(m, ms) {
  q("toast").textContent = m || "";
  clearTimeout(toastTimer);
  if (m && ms) toastTimer = setTimeout(() => { q("toast").textContent = ""; }, ms);
}
const front = (w) => (S.dir === "en2he" ? w.en : w.he);
const back = (w) => (S.dir === "en2he" ? w.he : w.en);
const isEnFront = () => S.dir === "en2he";

// ---------- practice state ----------
const P = { queue: [], i: 0, flip: false, ans: null, fb: null, score: { ok: 0, bad: 0 }, opts: [], msg: "", spoken: null };
function resetPractice() {
  P.queue = shuffle(pool()).map((w) => w.id);
  P.i = 0; P.flip = false; P.ans = null; P.fb = null; P.score = { ok: 0, bad: 0 }; P.msg = ""; P.spoken = null;
  makeOpts();
}
const cur = () => BYID[P.queue[P.i]];
function makeOpts() {
  const w = cur();
  P.opts = []; P.ans = null;
  if (!w) return;
  const correct = back(w);
  const others = shuffle(WORDS.filter((x) => back(x) !== correct)).slice(0, 3).map(back);
  P.opts = shuffle(others.concat([correct]));
}
function next() { P.i++; P.flip = false; P.ans = null; P.fb = null; makeOpts(); render(); }
function markKnown(id) {
  S.known[id] = 1; save();
  const k = P.queue.indexOf(id);
  if (k >= 0) { P.queue.splice(k, 1); if (k < P.i) P.i--; }
  P.flip = false; P.ans = null; P.fb = null; makeOpts(); render();
}

// ---------- rendering ----------
function renderTop() {
  q("lessons").innerHTML = lessons().map((l) => '<button class="chip' + (lessonOn(l) ? " on" : "") + '" data-act="lesson" data-v="' + l + '">שיעור ' + l + "</button>").join("") +
    '<button class="chip link" data-act="all">הכל</button><button class="chip link" data-act="none">נקה</button>';
  const sel = selected(), kn = sel.filter((w) => S.known[w.id]).length;
  q("stats").innerHTML = "<span>נבחרו: <b>" + sel.length + "</b></span><span>ידועות: <b>" + kn + "</b></span><span>לתרגול: <b>" + (sel.length - kn) + "</b></span>";
  q("barfill").style.width = (sel.length ? Math.round((kn / sel.length) * 100) : 0) + "%";
  const knownCount = Object.keys(S.known).filter((k) => BYID[k]).length;
  const tabs = [["cards", "כרטיסיות"], ["quiz", "בחירה"], ["type", "הקלדה"], ["listen", "🎧 האזנה"], ["list", "רשימה / ניהול"], ["known", "ידועות (" + knownCount + ")"]];
  q("tabs").innerHTML = tabs.map((t) => '<button class="tab' + (S.tab === t[0] ? " on" : "") + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + "</button>").join("");
}
function dirBar() {
  return '<div class="row" style="margin-bottom:10px"><span class="lbl" style="margin:0">כיוון:</span><select class="sel" data-act="dir"><option value="en2he"' + (S.dir === "en2he" ? " selected" : "") + '>אנגלית ← עברית</option><option value="he2en"' + (S.dir === "he2en" ? " selected" : "") + '>עברית ← אנגלית</option></select><button class="btn sm" data-act="restart">ערבב מחדש</button><label style="font-size:13px;display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" data-act="auto"' + (S.auto ? " checked" : "") + "> הקראה אוטומטית</label></div>";
}
function wordHTML(text, en) {
  return '<div class="big' + (en ? "" : " he") + '" dir="' + (en ? "ltr" : "rtl") + '">' + esc(text) + (en ? ' <button class="spk" data-act="speak" title="הקרא">🔊</button>' : "") + "</div>";
}
function doneHTML() {
  const n = pool().length;
  if (!selected().length) return '<div class="panel empty">בחר לפחות שיעור אחד למעלה.</div>';
  if (!n) return '<div class="panel empty">🎉 אין מילים לתרגול – כל המילים בשיעורים שנבחרו מסומנות כידועות.<br><br><button class="btn pri" data-act="tab" data-v="known">לרשימת הידועות</button></div>';
  return '<div class="panel empty">🎉 סיימת סבב!' + (P.score.ok + P.score.bad ? "<br>נכון: " + P.score.ok + " · שגוי: " + P.score.bad : "") + '<br><br><button class="btn pri" data-act="restart">סבב חדש</button></div>';
}
function progress() {
  return '<div class="row" style="justify-content:space-between;margin-bottom:6px"><button class="btn sm" data-act="back"' + (P.i > 0 ? "" : " disabled") + '>→ הקודם</button><span class="lbl" style="margin:0">' + (P.i + 1) + " / " + P.queue.length + '</span><span style="width:70px"></span></div>';
}
function renderCards() {
  const w = cur(); let h = dirBar();
  if (!w) { q("main").innerHTML = h + doneHTML(); return; }
  const f = isEnFront();
  const body = P.flip
    ? '<span class="tag">' + (f ? "עברית" : "English") + "</span>" + wordHTML(back(w), !f) + (w.ex ? '<div class="ex">' + esc(w.ex) + "</div>" : "")
    : '<span class="tag">' + (f ? "English" : "עברית") + "</span>" + wordHTML(front(w), f) + '<div class="hint">לחץ להיפוך</div>';
  h += progress() + '<div class="panel card" data-act="flip">' + body + '</div><div class="row c"><button class="btn" data-act="skip">עוד לא ↩</button><button class="btn ok" data-act="know">ידוע ✓</button></div>';
  q("main").innerHTML = h;
}
function renderQuiz() {
  const w = cur(); let h = dirBar();
  if (!w) { q("main").innerHTML = h + doneHTML(); return; }
  const f = isEnFront(), correct = back(w);
  h += progress() + '<div class="panel" style="text-align:center"><span class="tag">' + (f ? "מה פירוש המילה?" : "איך אומרים באנגלית?") + "</span>" + wordHTML(front(w), f) +
    '<div class="opts">' + P.opts.map((o, i) => {
      let c = "opt";
      if (P.ans !== null) { if (o === correct) c += " right"; else if (i === P.ans) c += " wrong"; }
      return '<button class="' + c + '" data-act="opt" data-v="' + i + '" dir="' + (f ? "rtl" : "ltr") + '">' + esc(o) + "</button>";
    }).join("") + "</div>";
  if (P.ans !== null) h += (w.ex ? '<div class="ex">' + esc(w.ex) + "</div>" : "") + '<div class="row c" style="margin-top:14px"><button class="btn ok" data-act="know">ידוע ✓</button><button class="btn pri" data-act="skip">הבא ←</button></div>';
  h += "</div>";
  q("main").innerHTML = h;
}
function renderType() {
  const w = cur(); let h = dirBar();
  if (!w) { q("main").innerHTML = h + doneHTML(); return; }
  const f = isEnFront();
  h += progress() + '<div class="panel" style="text-align:center"><span class="tag">' + (f ? "כתוב בעברית" : "Type in English") + "</span>" + wordHTML(front(w), f);
  if (P.fb === null) {
    h += '<div style="margin-top:16px"><input type="text" id="ans" autocomplete="off" autocapitalize="off" dir="' + (f ? "rtl" : "ltr") + '" placeholder="' + (f ? "התשובה..." : "Answer...") + '"></div><div class="row c" style="margin-top:12px"><button class="btn" data-act="reveal">הצג תשובה</button><button class="btn pri" data-act="check">בדוק</button></div>';
  } else {
    h += '<div class="fb ' + (P.fb.ok ? "ok" : "bad") + '">' + (P.fb.ok ? "✓ נכון!" : "✗ התשובה: ") + (P.fb.ok ? "" : '<span dir="' + (f ? "rtl" : "ltr") + '"><b>' + esc(back(w)) + "</b></span>") + "</div>" +
      (w.ex ? '<div class="ex">' + esc(w.ex) + "</div>" : "") + '<div class="row c" style="margin-top:14px"><button class="btn ok" data-act="know">ידוע ✓</button><button class="btn pri" data-act="skip">הבא ←</button></div>';
  }
  h += "</div>";
  q("main").innerHTML = h;
  const inp = q("ans");
  if (inp) { inp.focus(); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") checkType(); }); }
}
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[.,!?'"׳״]/g, "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
function variants(w) {
  const t = back(w), vs = [t];
  t.split(/\s*\/\s*/).forEach((x) => vs.push(x));
  if (w.v && !isEnFront()) vs.push(t.split(/\s*[–-]\s*/)[0]);
  if (!isEnFront()) vs.push(t.replace(/^to /i, ""));
  return vs.map(norm).filter(Boolean);
}
function checkType() {
  const w = cur(), inp = q("ans");
  if (!inp) return;
  const v = norm(inp.value);
  if (!v) return;
  const ok = variants(w).indexOf(v) >= 0;
  P.fb = { ok };
  ok ? P.score.ok++ : P.score.bad++;
  render();
}

// ----- list / manage -----
let pendingDel = null, pendingTimer = null;
function renderList() {
  const sel = selected();
  const ls = lessons();
  const defLesson = ls.length ? ls[ls.length - 1] : 1;
  let h = '<div class="panel"><p class="lbl">הוספת מילה</p><div class="form">' +
    '<div class="two"><input type="number" id="nw-lesson" min="1" value="' + defLesson + '" aria-label="שיעור"><input type="text" id="nw-en" dir="ltr" placeholder="English"></div>' +
    '<input type="text" id="nw-he" placeholder="עברית">' +
    '<input type="text" id="nw-ex" dir="ltr" placeholder="Example sentence (optional)">' +
    '<div class="row"><button class="btn pri" data-act="addword">הוסף</button><span class="lbl" style="margin:0">האודיו של מילה חדשה נוצר אוטומטית בפעם הבאה שתלחץ נגן.</span></div></div></div>';
  h += '<div class="panel">';
  if (!sel.length) h += '<div class="empty">בחר שיעור.</div>';
  else h += '<div class="list">' + sel.map((w) => {
    const k = S.known[w.id], armed = pendingDel === w.id;
    return '<div class="item' + (k ? " known" : "") + '"><div class="t"><div class="en">' + esc(w.en) + '</div><div class="he">' + esc(w.he) + '</div></div><button class="spk" data-act="speakid" data-v="' + esc(w.id) + '">🔊</button><span class="ltag">ש' + w.lesson + "</span>" +
      '<button class="btn sm' + (k ? "" : " ok") + '" data-act="toggle" data-v="' + esc(w.id) + '">' + (k ? "החזר" : "ידוע ✓") + "</button>" +
      '<button class="btn sm' + (armed ? " danger" : "") + '" data-act="del" data-v="' + esc(w.id) + '" aria-label="מחק">' + (armed ? "בטוח?" : "🗑") + "</button></div>";
  }).join("") + "</div>";
  h += "</div>";
  q("main").innerHTML = h;
}
function addWord() {
  const en = q("nw-en").value.trim(), he = q("nw-he").value.trim();
  const lesson = Math.max(1, parseInt(q("nw-lesson").value, 10) || 1);
  if (!en || !he) { toast("צריך למלא גם אנגלית וגם עברית", 2500); return; }
  S.custom.push({ id: "c:" + Date.now() + ":" + Math.floor(Math.random() * 1e4), lesson, en, he, ex: q("nw-ex").value.trim() });
  if (S.sel[lesson] === undefined) S.sel[lesson] = 1;
  save(); rebuildWords(); resetPractice(); L.stale = true; render();
  toast("נוספה: " + en, 2000);
}
function deleteWord(id) {
  if (pendingDel !== id) {
    pendingDel = id; clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingDel = null; if (S.tab === "list") render(); }, 3000);
    render(); return;
  }
  pendingDel = null;
  const w = BYID[id];
  if (w && w.custom) S.custom = S.custom.filter((c) => c.id !== id);
  else S.removed[id] = 1;
  delete S.known[id];
  save(); rebuildWords(); resetPractice(); L.stale = true; render();
}
function renderKnown() {
  const ids = Object.keys(S.known).filter((k) => BYID[k]);
  const removedBase = BASE.map((r) => ({ id: r.lesson + ":" + r.en, en: r.en, lesson: r.lesson })).filter((r) => S.removed[r.id]);
  let h = '<div class="panel"><p class="lbl">כל המילים שסימנת כידועות. אפשר להחזיר אותן לתרגול.</p>';
  if (!ids.length) h += '<div class="empty">עוד לא סימנת מילים.</div>';
  else h += '<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="restoreall">החזר את כולן</button></div><div class="list">' +
    ids.map((id) => { const w = BYID[id]; return '<div class="item"><div class="t"><div class="en">' + esc(w.en) + '</div><div class="he">' + esc(w.he) + '</div></div><span class="ltag">ש' + w.lesson + '</span><button class="btn sm" data-act="restore" data-v="' + esc(id) + '">החזר</button></div>'; }).join("") + "</div>";
  h += "</div>";
  if (removedBase.length) h += '<div class="panel"><p class="lbl">מילים מקוריות שמחקת</p><div class="list">' +
    removedBase.map((r) => '<div class="item"><div class="t"><div class="en">' + esc(r.en) + '</div></div><span class="ltag">ש' + r.lesson + '</span><button class="btn sm" data-act="undelete" data-v="' + esc(r.id) + '">שחזר</button></div>').join("") + "</div></div>";
  const dump = JSON.stringify({ known: ids, custom: S.custom, removed: Object.keys(S.removed) });
  h += '<div class="panel"><p class="lbl">גיבוד / שחזור (הנתונים נשמרים בדפדפן הזה; כאן אפשר להעתיק אותם למכשיר אחר)</p><textarea id="io" spellcheck="false">' + esc(dump) + '</textarea>' +
    '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy">העתק</button><button class="btn sm pri" data-act="import">טען מהתיבה</button></div><div class="lbl" id="iomsg" style="margin-top:8px">' + esc(P.msg) + "</div></div>";
  q("main").innerHTML = h;
}

// ---------- listen mode (single WAV through one <audio>) ----------
const aud = q("aud");
const L = { sess: null, key: "", url: null, idx: -1, building: false, stale: true, progress: "", diag: "" };
const cleanHe = (s) => s.replace(/\.\.\./g, "").replace(/\s*[–/]\s*/g, ", ").replace(/[()]/g, " ").trim();
const cleanEn = (s) => s.replace(/\(.*?\)/g, "").replace(/\.\.\./g, "").replace(/\s*[–/]\s*/g, ", ").trim();
// 0.5s of silence, used to "unlock" the audio element inside the tap on iOS
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

function sessionKey(words) { return words.map((w) => w.id).join("|") + "#" + S.listen.pause + "#" + S.listen.gap + "#" + S.listen.enEngine + S.listen.kvoice + S.listen.heMode; }
function setMedia(w) {
  if (!("mediaSession" in navigator) || !w) return;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: w.en, artist: w.he, album: "אוצר מילים" }); } catch (e) {}
}
function installMediaHandlers() {
  if (!("mediaSession" in navigator)) return;
  const h = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch (e) {} };
  h("play", () => (S.listen.mode2 === "speech" ? startSpeech() : aud.play()));
  h("pause", () => (S.listen.mode2 === "speech" ? stopSpeech() : aud.pause()));
  h("nexttrack", () => jump(1));
  h("previoustrack", () => jump(-1));
}
function jump(d) {
  if (S.listen.mode2 === "speech") { spJump(d); return; }
  if (!L.sess) return;
  const m = L.sess.marks;
  const i = (markIndexAt(m, aud.currentTime) + d + m.length) % m.length;
  aud.currentTime = m[i].start + 0.01;
}
function showNow(i) {
  L.idx = i;
  const w = L.sess && BYID[L.sess.marks[i].id];
  const el = q("lnow");
  if (!el || !w) return;
  el.innerHTML = '<div class="big he">' + esc(w.he) + '</div><div class="big" dir="ltr" style="margin-top:8px">' + esc(w.en) + '</div><div class="hint">' + (i + 1) + " / " + L.sess.marks.length + "</div>";
  setMedia(w);
}
aud.addEventListener("timeupdate", () => {
  if (S.listen.mode2 !== "wav" || !L.sess) return;
  const i = markIndexAt(L.sess.marks, aud.currentTime);
  if (i !== L.idx) showNow(i);
});
aud.addEventListener("play", () => { if (S.tab === "listen") updPlayBtn(); });
aud.addEventListener("pause", () => { if (S.tab === "listen") updPlayBtn(); });
function updPlayBtn() {
  const b = q("lplay");
  if (b) b.textContent = L.building ? "⏳ מכין..." : (S.listen.mode2 === "speech" ? !SP.on : aud.paused) ? "▶ נגן" : "⏸ עצור";
}
function setProgress(t) {
  L.progress = t;
  const el = q("lprog");
  if (el) el.textContent = t;
}
async function prepareSession() {
  let words = pool();
  if (S.listen.shuf) words = shuffle(words);
  const key = sessionKey(words);
  if (L.sess && !L.stale && !S.listen.shuf && key === L.key) return true;
  L.building = true; updPlayBtn();
  try {
    const engOpts = { enEngine: S.listen.enEngine, kvoice: S.listen.kvoice };
    setStatusHandler((t) => setProgress(t));
    const sess = await buildSession((t, l) => getWav(t, l, engOpts), words, { pause: S.listen.pause, gap: S.listen.gap, cleanHe: S.listen.heMode === "espeak" ? cleanHe : null, cleanEn }, (i, n) => setProgress(i < n ? "מכין אודיו… " + i + " / " + n + " (בפעם הראשונה לוקח זמן, אחר כך זה נשמר)" : ""));
    if (L.url) URL.revokeObjectURL(L.url);
    L.url = URL.createObjectURL(new Blob([sess.wav], { type: "audio/wav" }));
    L.sess = sess; L.key = key; L.stale = false; L.idx = -1;
    aud.src = L.url;
    return true;
  } catch (e) {
    setProgress("");
    toast("שגיאה בהכנת האודיו: " + (e && e.message ? e.message : e) + " — נסה 'בדיקת מנוע'.", 8000);
    return false;
  } finally {
    L.building = false; updPlayBtn();
  }
}
async function playListen() {
  if (S.listen.mode2 === "speech") {
    if (SP.on) stopSpeech(); else startSpeech();
    setTimeout(updPlayBtn, 50);
    return;
  }
  if (L.building) return;
  if (!aud.paused) { aud.pause(); return; }
  toast("");
  if (!pool().length) return;
  // unlock the element inside the user gesture (needed on iOS, since building takes a while)
  if (!L.sess || L.stale) { aud.src = SILENT; aud.loop = false; aud.play().catch(() => {}); }
  const ok = await prepareSession();
  aud.loop = true;
  if (!ok) { aud.pause(); return; }
  installMediaHandlers();
  try { await aud.play(); } catch (e) { toast("הדפדפן חסם את הנגינה: לחץ שוב על נגן.", 5000); }
  if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "playing"; } catch (e) {} }
}
function listenKnown() {
  if (S.listen.mode2 === "speech") { spKnown(); return; }
  if (!L.sess || L.idx < 0) return;
  const id = L.sess.marks[L.idx].id;
  S.known[id] = 1; save(); L.stale = true;
  renderTop();
  toast("סומנה כידועה. היא תדולג בהכנה הבאה (עצור ולחץ נגן).", 3500);
}
// ----- listen mode B: device speech + silent looping <audio> (keeps the media session alive) -----
const SP = { on: false, list: [], idx: 0, token: 0, bgSpoken: 0, hideAt: null, bgAtHide: 0, url: null };
function silentUrl() {
  if (!SP.url) {
    const a = new Int16Array(16000);
    for (let i = 0; i < a.length; i++) a[i] = ((Math.random() * 5) | 0) - 2; // near-silent dither, so it is real audio
    SP.url = URL.createObjectURL(new Blob([encodeWav(a, 8000)], { type: "audio/wav" }));
  }
  return SP.url;
}
function voicesFor(lang) {
  const pre = lang === "he" ? ["he", "iw"] : ["en"];
  return (window.speechSynthesis ? speechSynthesis.getVoices() || [] : []).filter((x) => pre.some((p) => (x.lang || "").toLowerCase().indexOf(p) === 0));
}
function pickVoice(lang) {
  const list = voicesFor(lang), saved = lang === "he" ? S.listen.voiceHe : S.listen.voiceEn;
  return list.filter((x) => x.name === saved)[0] || list[0];
}
function sayText(text, lang, cb) {
  let done = false, t;
  const fin = () => { if (done) return; done = true; clearTimeout(t); cb(); };
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "he" ? "he-IL" : "en-US"; u.rate = +S.listen.rate || 0.9;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.onstart = () => { if (document.hidden) { SP.bgSpoken++; updBgLog(); } };
    u.onend = fin; u.onerror = fin;
    t = setTimeout(fin, 6000 + text.length * 250); // if the browser swallows the utterance, keep the loop going
    speechSynthesis.speak(u);
  } catch (e) { fin(); }
}
function showWordSp(w) {
  const el = q("lnow");
  setMedia(w);
  if (!el) return;
  el.innerHTML = '<div class="big he">' + esc(w.he) + '</div><div class="big" dir="ltr" style="margin-top:8px">' + esc(w.en) + '</div><div class="hint">' + (SP.idx + 1) + " / " + SP.list.length + "</div>";
}
function spStep(tok) {
  if (tok !== SP.token || !SP.on) return;
  if (SP.idx >= SP.list.length) {
    SP.list = S.listen.shuf ? shuffle(pool()) : pool(); SP.idx = 0;
    if (!SP.list.length) { stopSpeech(); render(); return; }
  }
  const w = SP.list[SP.idx];
  showWordSp(w);
  sayText(cleanHe(w.he), "he", () => {
    if (tok !== SP.token) return;
    setTimeout(() => {
      if (tok !== SP.token) return;
      sayText(cleanEn(w.en), "en", () => {
        if (tok !== SP.token) return;
        setTimeout(() => { if (tok !== SP.token) return; SP.idx++; spStep(tok); }, S.listen.gap * 1000);
      });
    }, S.listen.pause * 1000);
  });
}
function startSpeech() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { toast("ההקראה לא נתמכת בדפדפן הזה.", 4000); return; }
  stopSpeech();
  SP.list = S.listen.shuf ? shuffle(pool()) : pool(); SP.idx = 0;
  if (!SP.list.length) return;
  toast("");
  SP.on = true; SP.bgSpoken = 0;
  const tok = ++SP.token;
  aud.src = silentUrl(); aud.loop = true; // inside the user gesture: start the silent audio first
  aud.play().catch(() => toast("הדפדפן חסם את האודיו השקט: לחץ שוב על נגן.", 4000));
  installMediaHandlers();
  try { navigator.mediaSession.playbackState = "playing"; } catch (e) {}
  spStep(tok);
}
function stopSpeech() {
  SP.on = false; SP.token++;
  try { speechSynthesis.cancel(); } catch (e) {}
  if (S.listen.mode2 === "speech") aud.pause();
}
function spJump(d) {
  if (!SP.on) return;
  SP.idx = Math.max(0, SP.idx + d);
  try { speechSynthesis.cancel(); } catch (e) {}
  spStep(++SP.token);
}
function spKnown() {
  if (!SP.on || !SP.list[SP.idx]) return;
  S.known[SP.list[SP.idx].id] = 1; save(); L.stale = true;
  SP.list.splice(SP.idx, 1);
  renderTop();
  try { speechSynthesis.cancel(); } catch (e) {}
  spStep(++SP.token);
}
function updBgLog(msg) {
  const el = q("bglog");
  if (el) el.textContent = msg || ("הקראות שהתחילו כשהדף ברקע: " + SP.bgSpoken);
}
document.addEventListener("visibilitychange", () => {
  if (S.listen.mode2 !== "speech") return;
  if (document.hidden) { SP.hideAt = Date.now(); SP.bgAtHide = SP.bgSpoken; return; }
  if (SP.on) { try { speechSynthesis.resume(); } catch (e) {} }
  if (SP.hideAt && SP.on) {
    const sec = Math.round((Date.now() - SP.hideAt) / 1000), n = SP.bgSpoken - SP.bgAtHide;
    updBgLog("הדף היה ברקע " + sec + " שנ' · הוקראו " + n + " הקראות " + (n > 0 ? "✅ ההקראה המשיכה" : "❌ ההקראה נעצרה"));
  }
  SP.hideAt = null;
});

async function runDiag() {
  const el = q("diag");
  el.textContent = "בודק… (בפעם הראשונה מוריד את מנוע ה-TTS)";
  try {
    setStatusHandler((t) => { el.textContent = t; });
    const r = await selfTest({ enEngine: S.listen.enEngine, kvoice: S.listen.kvoice, testHebrew: S.listen.heMode === "espeak" });
    el.textContent = "✅ המנוע עובד\nentry: " + r.entry + "\nmode: " + r.mode + "\nאנגלית: " + r.enBytes + " bytes" + (r.heBytes ? ", עברית: " + r.heBytes + " bytes" : "") + "\nזמן: " + r.ms + "ms\nמילים בקאש: " + (await cacheSize());
  } catch (e) {
    el.textContent = "❌ " + (e && e.stack ? e.stack : e);
  }
}
function wavPicker() {
  const kv = [["af_heart", "Heart (אמריקאית, נקבה)"], ["af_bella", "Bella (אמריקאית, נקבה)"], ["am_michael", "Michael (אמריקאי, זכר)"], ["bf_emma", "Emma (בריטית, נקבה)"], ["bm_george", "George (בריטי, זכר)"]];
  return '<div class="row" style="margin-top:12px"><span class="lbl" style="margin:0;min-width:46px">English</span><select class="sel" data-act="lset" data-k="enEngine"><option value="kokoro"' + (S.listen.enEngine === "kokoro" ? " selected" : "") + '>קול טבעי (Kokoro, מודל ~90MB בפעם הראשונה)</option><option value="espeak"' + (S.listen.enEngine === "espeak" ? " selected" : "") + '>eSpeak (רובוטי, קטן)</option></select>' +
    (S.listen.enEngine === "kokoro" ? '<select class="sel" data-act="lset" data-k="kvoice">' + kv.map((x) => '<option value="' + x[0] + '"' + (S.listen.kvoice === x[0] ? " selected" : "") + ">" + x[1] + "</option>").join("") + "</select>" : "") + "</div>" +
    '<div class="row" style="margin-top:8px"><span class="lbl" style="margin:0;min-width:46px">עברית</span><select class="sel" data-act="lset" data-k="heMode"><option value="none"' + (S.listen.heMode === "none" ? " selected" : "") + '>ללא (רק אנגלית)</option><option value="espeak"' + (S.listen.heMode === "espeak" ? " selected" : "") + ">eSpeak (רובוטי)</option></select></div>";
}
function voicePicker() {
  const one = (lang, key, label) => {
    const list = voicesFor(lang), cur = (pickVoice(lang) || {}).name;
    const opts = list.length ? list.map((x) => '<option value="' + esc(x.name) + '"' + (x.name === cur ? " selected" : "") + ">" + esc(x.name) + " (" + esc(x.lang) + (x.localService ? "" : ", רשת") + ")</option>").join("") : "<option>אין קולות במכשיר</option>";
    return '<div class="row" style="margin-top:8px"><span class="lbl" style="margin:0;min-width:46px">' + label + '</span><select class="sel" style="flex:1;min-width:0" data-act="lset" data-k="' + key + '">' + opts + '</select><button class="btn sm" data-act="vtest" data-v="' + lang + '">🔊</button></div>';
  };
  return '<p class="lbl" style="margin-top:12px">קולות (אם הקול נשמע רובוטי, נסה קול אחר מהרשימה; קולות "רשת" הם בדרך כלל הטובים ביותר):</p>' + one("en", "voiceEn", "English") + one("he", "voiceHe", "עברית");
}
if ("speechSynthesis" in window && typeof speechSynthesis.addEventListener === "function") speechSynthesis.addEventListener("voiceschanged", () => { if (S.tab === "listen" && !SP.on) render(); });
function renderListen() {
  const n = pool().length;
  if (!selected().length) { q("main").innerHTML = '<div class="panel empty">בחר לפחות שיעור אחד למעלה.</div>'; return; }
  if (!n) { q("main").innerHTML = '<div class="panel empty">אין מילים להאזנה – כולן מסומנות כידועות.</div>'; return; }
  const sel = (k, vals, labels) => '<select class="sel" data-act="lset" data-k="' + k + '">' + vals.map((v, i) => '<option value="' + v + '"' + (+S.listen[k] === v ? " selected" : "") + ">" + labels[i] + "</option>").join("") + "</select>";
  const speechMode = S.listen.mode2 === "speech";
  const w = speechMode ? (SP.on && SP.list[SP.idx]) : (L.sess && L.idx >= 0 && BYID[L.sess.marks[L.idx].id]);
  const now = w
    ? '<div class="big he">' + esc(w.he) + '</div><div class="big" dir="ltr" style="margin-top:8px">' + esc(w.en) + '</div><div class="hint">' + (speechMode ? SP.idx + 1 + " / " + SP.list.length : L.idx + 1 + " / " + L.sess.marks.length) + "</div>"
    : '<div class="hint">' + n + " מילים מוכנות להאזנה<br>לחץ ▶ להתחלה</div>";
  const modeSel = '<select class="sel" data-act="lset" data-k="mode2"><option value="speech"' + (speechMode ? " selected" : "") + '>הקראת הדפדפן + אודיו שקט (ניסוי)</option><option value="wav"' + (speechMode ? "" : " selected") + '>קובץ אודיו (קול טבעי, עובד ברקע)</option></select>';
  q("main").innerHTML = '<div class="panel"><div class="row" style="margin-bottom:8px"><span class="lbl" style="margin:0">מצב:</span>' + modeSel + '</div><p class="lbl">מקריא את כל המילים שעוד לא סימנת כידועות: עברית, הפסקה, אנגלית, ובסוף הרשימה חוזר להתחלה.</p>' +
    '<div id="lnow" class="card" style="min-height:150px;cursor:default;padding:16px">' + now + "</div>" +
    '<div class="lbl" id="lprog" style="text-align:center;margin-top:8px">' + esc(speechMode ? "" : L.progress) + "</div>" +
    '<div class="lbl" id="bglog" style="text-align:center">' + (speechMode ? "אחרי שתחזור מהרקע יוצג כאן אם ההקראה המשיכה." : "") + "</div>" +
    '<div class="row c" style="margin-top:6px"><button class="btn" data-act="lprev">⏮</button><button class="btn pri" id="lplay" style="font-size:20px;padding:8px 26px" data-act="lplay">' + (L.building ? "⏳ מכין..." : (speechMode ? !SP.on : aud.paused) ? "▶ נגן" : "⏸ עצור") + '</button><button class="btn" data-act="lnext">⏭</button><button class="btn ok" data-act="lknown">ידוע ✓</button></div></div>' +
    '<div class="panel"><div class="row" style="gap:12px">' +
    '<label class="lbl" style="margin:0">הפסקה עברית→אנגלית ' + sel("pause", [0.5, 1, 2, 3], ["חצי שנייה", "שנייה", "2 שניות", "3 שניות"]) + "</label>" +
    '<label class="lbl" style="margin:0">בין מילים ' + sel("gap", [1, 2, 3, 5], ["שנייה", "2 שניות", "3 שניות", "5 שניות"]) + "</label>" +
    (speechMode ? '<label class="lbl" style="margin:0">מהירות ' + sel("rate", [0.7, 0.9, 1.1], ["איטית", "רגילה", "מהירה"]) + "</label>" : "") +
    '<label style="font-size:13px;display:flex;gap:5px;align-items:center"><input type="checkbox" data-act="lset" data-k="shuf"' + (S.listen.shuf ? " checked" : "") + "> ערבוב</label></div>" +
    (speechMode ? voicePicker() : wavPicker()) +
    '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="diag">בדיקת מנוע</button><button class="btn sm" data-act="clearcache">נקה קאש אודיו</button></div><div id="diag"></div></div>';
}

// ---------- speech (cards only; not for background) ----------
function speak(id) {
  const w = id ? BYID[id] : cur();
  if (!w) return;
  const NO = "לא נשמע קול. ההקראה לא עובדת במסך הזה. נסה לפתוח בכרום או בספארי ובדוק שהטלפון לא על שקט.";
  toast("");
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { toast(NO, 5000); return; }
  try {
    const u = new SpeechSynthesisUtterance(w.en.replace(/\(.*?\)/g, "").replace(/\s*\/\s*/g, ", "));
    u.lang = "en-US"; u.rate = 0.9;
    const ev = (speechSynthesis.getVoices() || []).filter((x) => /^en/i.test(x.lang))[0];
    if (ev) u.voice = ev;
    u.onerror = () => toast(NO, 5000);
    u.onstart = () => { u._ok = 1; toast(""); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    setTimeout(() => { if (!speechSynthesis.speaking && !speechSynthesis.pending && !u._ok) toast(NO, 5000); }, 1500);
  } catch (e) { toast(NO, 5000); }
}
function autoSpeak() {
  if (!S.auto || ["cards", "quiz", "type"].indexOf(S.tab) < 0) return;
  const w = cur();
  if (!w) return;
  if (!(isEnFront() || P.flip || P.ans !== null || P.fb !== null)) return;
  if (P.spoken === w.id) return;
  P.spoken = w.id; speak();
}

function render() {
  renderTop();
  ({ cards: renderCards, quiz: renderQuiz, type: renderType, listen: renderListen, list: renderList, known: renderKnown })[S.tab]();
  autoSpeak();
}

// ---------- events ----------
document.addEventListener("change", (e) => {
  const t = e.target, a = t.dataset && t.dataset.act;
  if (a === "dir") { S.dir = t.value; save(); resetPractice(); render(); }
  else if (a === "lset") { const k = t.dataset.k; S.listen[k] = t.type === "checkbox" ? t.checked : (k === "mode2" || k === "enEngine" || k === "kvoice" || k === "heMode" || k === "voiceHe" || k === "voiceEn") ? t.value : +t.value; save(); L.stale = true; if (k === "mode2") { stopSpeech(); aud.pause(); render(); } else if (k === "enEngine" || k === "heMode") render(); }
  else if (a === "auto") { S.auto = t.checked; save(); if (S.auto) { P.spoken = null; autoSpeak(); } }
});
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  const a = el.dataset.act, v = el.dataset.v;
  switch (a) {
    case "lesson": S.sel[v] = lessonOn(+v) ? 0 : 1; save(); L.stale = true; resetPractice(); render(); break;
    case "all": lessons().forEach((l) => { S.sel[l] = 1; }); save(); L.stale = true; resetPractice(); render(); break;
    case "none": lessons().forEach((l) => { S.sel[l] = 0; }); save(); L.stale = true; resetPractice(); render(); break;
    case "tab": S.tab = v; save(); resetPractice(); render(); break;
    case "restart": resetPractice(); render(); break;
    case "flip": P.flip = !P.flip; render(); break;
    case "speak": speak(); break;
    case "speakid": speak(v); break;
    case "lplay": playListen(); break;
    case "lprev": jump(-1); break;
    case "lnext": jump(1); break;
    case "lknown": listenKnown(); break;
    case "diag": runDiag(); break;
    case "vtest": try { speechSynthesis.cancel(); } catch (err) {} sayText(v === "he" ? "שלום, זה בדיקה של הקול" : "Hello, this is a test of the voice", v, () => {}); break;
    case "clearcache": clearCache().then(() => { L.stale = true; toast("הקאש נוקה", 2000); }); break;
    case "skip": next(); break;
    case "back": if (P.i > 0) { P.i--; P.flip = false; P.ans = null; P.fb = null; P.spoken = null; makeOpts(); render(); } break;
    case "know": markKnown(P.queue[P.i]); break;
    case "opt": if (P.ans === null) { P.ans = +v; P.opts[+v] === back(cur()) ? P.score.ok++ : P.score.bad++; render(); } break;
    case "check": checkType(); break;
    case "reveal": P.fb = { ok: false }; P.score.bad++; render(); break;
    case "toggle": if (S.known[v]) delete S.known[v]; else S.known[v] = 1; save(); L.stale = true; resetPractice(); render(); break;
    case "restore": delete S.known[v]; save(); L.stale = true; resetPractice(); render(); break;
    case "restoreall": S.known = {}; save(); L.stale = true; resetPractice(); render(); break;
    case "addword": addWord(); break;
    case "del": deleteWord(v); break;
    case "undelete": delete S.removed[v]; save(); rebuildWords(); L.stale = true; resetPractice(); render(); break;
    case "copy": {
      const ta = q("io");
      ta.select();
      try { navigator.clipboard.writeText(ta.value).then(() => { q("iomsg").textContent = "הועתק ✓"; }, () => { q("iomsg").textContent = "סמן והעתק ידנית"; }); } catch (err) { q("iomsg").textContent = "סמן והעתק ידנית"; }
      break;
    }
    case "import":
      try {
        const data = JSON.parse(q("io").value);
        const ids = Array.isArray(data) ? data : data.known || [];
        if (!Array.isArray(ids)) throw new Error("bad");
        if (!Array.isArray(data)) {
          S.custom = Array.isArray(data.custom) ? data.custom : S.custom;
          S.removed = {}; (data.removed || []).forEach((id) => { S.removed[id] = 1; });
          rebuildWords();
        }
        const k = {}; ids.forEach((id) => { if (BYID[id]) k[id] = 1; });
        S.known = k; save(); L.stale = true;
        P.msg = "נטען ✓ (" + Object.keys(k).length + " מילים ידועות)";
        resetPractice(); render();
      } catch (err) { q("iomsg").textContent = "פורמט לא תקין"; }
      break;
  }
});

// ---------- boot ----------
(async function boot() {
  try {
    BASE = await (await fetch("words.json?v=5")).json();
  } catch (e) {
    q("main").innerHTML = '<div class="panel empty">לא הצלחתי לטעון את words.json. פתח את האתר דרך כתובת (לא כקובץ מקומי).</div>';
    return;
  }
  rebuildWords();
  resetPractice();
  render();
})();
