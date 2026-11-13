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

let chain = Promise.resolve(); // espeak is not re-entrant: serialise calls

/** Returns WAV bytes (Uint8Array) for text in lang ("he" | "en"). Cached. */
export function getWav(text, lang) {
  const key = lang + "|" + SPEED + "|" + text;
  const job = chain.then(async () => {
    const hit = await idbGet(key);
    if (hit) return new Uint8Array(hit);
    const bytes = await runEspeak(text, VOICES[lang]);
    const copy = new Uint8Array(bytes); // detach from the wasm heap
    await idbPut(key, copy.buffer.slice(0));
    return copy;
  });
  chain = job.catch(() => {});
  return job;
}

/** Quick self-test used by the "בדיקת מנוע" button. */
export async function selfTest() {
  const t0 = performance.now();
  const he = await getWav("שלום", "he");
  const en = await getWav("hello", "en");
  return { heBytes: he.length, enBytes: en.length, ms: Math.round(performance.now() - t0), entry: engineInfo.entry, mode: engineInfo.mode };
}
