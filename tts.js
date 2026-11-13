// Browser-side TTS: eSpeak-NG compiled to WebAssembly (npm package "espeak-ng", loaded from a CDN),
// with generated WAVs cached in IndexedDB so each word is synthesised only once.

const CDN_BASE = "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/";
const VOICES = { he: "he", en: "en-us" };
const SPEED = 150; // words per minute (espeak default is 175)

let factoryPromise = null;
let instance = null;
let reuseOk = true;
export const engineInfo = { entry: null, mode: null };

function loadFactory() {
  if (!factoryPromise) {
    factoryPromise = (async () => {
      const pkg = await (await fetch(CDN_BASE + "package.json")).json();
      const entry = String(pkg.module || pkg.main || "index.js").replace(/^\.\//, "");
      engineInfo.entry = entry;
      const mod = await import(CDN_BASE + entry);
      const factory = mod.default || mod;
      if (typeof factory !== "function") throw new Error("espeak-ng entry (" + entry + ") has no default factory");
      return factory;
    })().catch((e) => { factoryPromise = null; throw e; });
  }
  return factoryPromise;
}

const quiet = { print() {}, printErr() {} };

async function runEspeak(text, voice) {
  const factory = await loadFactory();
  const args = ["-v", voice, "-s", String(SPEED), "-w", "out.wav", text];
  if (reuseOk) {
    try {
      if (!instance) instance = await factory({ noInitialRun: true, ...quiet });
      if (typeof instance.callMain !== "function") throw new Error("callMain not exported");
      try { instance.FS.unlink("out.wav"); } catch (e) {}
      try { instance.callMain(args); } catch (e) { /* ExitStatus on exit is fine */ }
      const bytes = instance.FS.readFile("out.wav");
      engineInfo.mode = "reuse";
      return bytes;
    } catch (e) {
      reuseOk = false;
      instance = null;
    }
  }
  const m = await factory({ arguments: args, ...quiet });
  engineInfo.mode = "per-call";
  return m.FS.readFile("out.wav");
}

// ---- IndexedDB cache ----
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open("vocab-tts", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("wav");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}
async function idbGet(key) {
  try {
    const d = await db();
    return await new Promise((res) => { const q = d.transaction("wav").objectStore("wav").get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  } catch (e) { return undefined; }
}
async function idbPut(key, val) {
  try {
    const d = await db();
    await new Promise((res) => { const t = d.transaction("wav", "readwrite"); t.objectStore("wav").put(val, key); t.oncomplete = res; t.onerror = res; });
  } catch (e) {}
}
export async function clearCache() {
  try { const d = await db(); await new Promise((res) => { const t = d.transaction("wav", "readwrite"); t.objectStore("wav").clear(); t.oncomplete = res; t.onerror = res; }); } catch (e) {}
}
export async function cacheSize() {
  try { const d = await db(); return await new Promise((res) => { const q = d.transaction("wav").objectStore("wav").count(); q.onsuccess = () => res(q.result); q.onerror = () => res(0); }); } catch (e) { return 0; }
}

// ---- Kokoro (natural-sounding English, runs locally via transformers.js) ----
const KOKORO_URL = "https://esm.sh/kokoro-js@1.2.1";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let kokoroPromise = null;
let statusHandler = null;
export function setStatusHandler(fn) { statusHandler = fn; }
function loadKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      if (statusHandler) statusHandler("טוען את מנוע הקול…");
      const { KokoroTTS } = await import(KOKORO_URL);
      return KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: "q8", device: "wasm",
        progress_callback: (p) => {
          if (statusHandler && p && p.status === "progress" && typeof p.progress === "number") statusHandler("מוריד מודל קול (חד פעמי): " + Math.round(p.progress) + "%");
        }
      });
    })().catch((e) => { kokoroPromise = null; throw e; });
  }
  return kokoroPromise;
}
function floatToWav(f32, rate) {
  const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767), true);
  return new Uint8Array(buf);
}
async function runKokoro(text, voice) {
  const tts = await loadKokoro();
  const out = await tts.generate(text, { voice });
  if (out && out.audio && out.sampling_rate) return floatToWav(out.audio, out.sampling_rate);
  if (out && typeof out.toWav === "function") return new Uint8Array(out.toWav()); // audio.js also reads float32 WAVs
  throw new Error("unexpected Kokoro output");
}

let chain = Promise.resolve(); // the engines are not re-entrant: serialise calls

/**
 * Returns WAV bytes (Uint8Array) for text in lang ("he" | "en"). Cached.
 * opts: { enEngine: "kokoro" | "espeak", kvoice: "af_heart" }
 */
export function getWav(text, lang, opts = {}) {
  const useKokoro = lang === "en" && opts.enEngine === "kokoro";
  const kvoice = opts.kvoice || "af_heart";
  const key = useKokoro ? "en|kokoro|" + kvoice + "|" + text : lang + "|" + SPEED + "|" + text;
  const job = chain.then(async () => {
    const hit = await idbGet(key);
    if (hit) return new Uint8Array(hit);
    const bytes = useKokoro ? await runKokoro(text, kvoice) : await runEspeak(text, VOICES[lang]);
    const copy = new Uint8Array(bytes); // detach from the wasm heap
    await idbPut(key, copy.buffer.slice(0));
    return copy;
  });
  chain = job.catch(() => {});
  return job;
}

/** Quick self-test used by the "בדיקת מנוע" button. */
export async function selfTest(opts = {}) {
  const t0 = performance.now();
  const en = await getWav("hello", "en", opts);
  let heBytes = null;
  if (opts.testHebrew) heBytes = (await getWav("שלום", "he")).length;
  return { heBytes, enBytes: en.length, ms: Math.round(performance.now() - t0), entry: engineInfo.entry, mode: engineInfo.mode };
}
