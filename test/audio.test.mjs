import assert from "node:assert/strict";
import { parseWav, encodeWav, resample, buildSession, markIndexAt } from "../audio.js";

// fake "TTS": a tone whose length depends on the text, at different sample rates per language
function tone(len, rate, amp = 8000) {
  const s = new Int16Array(len);
  for (let i = 0; i < len; i++) s[i] = Math.round(Math.sin(i / 10) * amp);
  return new Uint8Array(encodeWav(s, rate));
}
const fakeWav = async (text, lang) => tone(text.length * 1000, lang === "he" ? 22050 : 16000);

// 1. round trip
const w = parseWav(tone(500, 22050));
assert.equal(w.rate, 22050);
assert.equal(w.samples.length, 500);

// 2. streamed header with bogus data size (0xFFFFFFFF) is clamped
const bad = tone(300, 22050);
new DataView(bad.buffer).setUint32(40, 0xffffffff, true);
assert.equal(parseWav(bad).samples.length, 300);

// 3. resample length
assert.equal(resample(new Int16Array(16000), 16000, 22050).length, 22050);

// 4. session: marks are ordered, contiguous and cover the whole file
const words = [{ id: "a", he: "שלום", en: "Hello" }, { id: "b", he: "תודה", en: "Thanks" }, { id: "c", he: "בבקשה", en: "Please" }];
const progress = [];
const s = await buildSession(fakeWav, words, { pause: 1, gap: 2, cleanHe: (x) => x, cleanEn: (x) => x }, (i, n) => progress.push([i, n]));
assert.equal(s.marks.length, 3);
assert.equal(s.marks[0].start, 0);
for (let i = 1; i < 3; i++) assert.ok(Math.abs(s.marks[i].start - s.marks[i - 1].end) < 1e-9);
assert.ok(Math.abs(s.marks[2].end - s.duration) < 1e-9);
assert.deepEqual(progress[progress.length - 1], [3, 3]);
const out = parseWav(new Uint8Array(s.wav));
assert.equal(out.samples.length, Math.round(s.duration * s.rate));
// each word has at least pause+gap = 3 seconds of silence inside it
assert.ok(s.marks[0].end - s.marks[0].start > 3);

// 5. lookup by time
assert.equal(markIndexAt(s.marks, 0), 0);
assert.equal(markIndexAt(s.marks, s.marks[1].start + 0.01), 1);
assert.equal(markIndexAt(s.marks, s.duration - 0.01), 2);

// 6. float32 WAV (what some neural TTS libraries emit) is converted to 16-bit
{
  const n = 400, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const w4 = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w4(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w4(8, "WAVE"); w4(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 96000, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  w4(36, "data"); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) v.setFloat32(44 + i * 4, i % 2 ? 0.5 : -0.5, true);
  const f = parseWav(new Uint8Array(buf));
  assert.equal(f.rate, 24000); assert.equal(f.samples.length, n);
  assert.ok(Math.abs(f.samples[1] - 16384) <= 1 && Math.abs(f.samples[0] + 16384) <= 1);
}

// 7. English-only session (no cleanHe): one clip + gap per word
{
  const s2 = await buildSession(fakeWav, words, { pause: 1, gap: 2, cleanEn: (x) => x });
  assert.equal(s2.marks.length, 3);
  const first = s2.marks[0].end - s2.marks[0].start;
  assert.ok(first > 2 && first < 2 + 0.7, "english-only length " + first);
}

console.log("audio tests passed; session", s.duration.toFixed(1) + "s,", (s.wav.byteLength / 1024).toFixed(0) + "KB");
