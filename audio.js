// Pure audio helpers: WAV parsing, resampling and assembling one long playlist WAV.
// No DOM / browser APIs here, so it can be tested in Node.

export function parseWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12, rate = 0, channels = 1, bits = 16, dataStart = -1, dataLen = 0;
  while (pos + 8 <= u8.length) {
    const id = tag(pos);
    let size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      // streamed WAVs may carry a bogus (0 or 0xFFFFFFFF) size: clamp to what we have
      if (size === 0 || size > u8.length - body) size = u8.length - body;
      dataLen = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (dataStart < 0) throw new Error("WAV has no data chunk");
  if (bits !== 16) throw new Error("only 16-bit WAV is supported (got " + bits + ")");
  const frames = Math.floor(dataLen / (2 * channels));
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += v.getInt16(dataStart + (i * channels + c) * 2, true);
    out[i] = Math.round(sum / channels);
  }
  return { rate, samples: out };
}

export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const n = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Int16Array(n);
  const ratio = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const p = i * ratio, i0 = Math.floor(p), i1 = Math.min(i0 + 1, samples.length - 1), f = p - i0;
    out[i] = Math.round(samples[i0] * (1 - f) + samples[i1] * f);
  }
  return out;
}

export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); s(8, "WAVE");
  s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, "data"); v.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44, samples.length).set(samples);
  return buf;
}

// Normalises quiet espeak output a bit and trims long leading/trailing silence.
export function trim(samples, rate) {
  const thr = 300;
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  const pad = Math.round(rate * 0.04);
  return samples.subarray(Math.max(0, a - pad), Math.min(samples.length, b + pad));
}

/**
 * Builds ONE long WAV for the whole listening session so a single <audio> element
 * can play it in the background without ever swapping `src`.
 *
 * getWav(text, lang) -> Promise<Uint8Array|ArrayBuffer>   (WAV bytes for that text)
 * words: [{id, he, en}]
 * opts: { pause, gap, cleanHe, cleanEn, rate? }  (pause/gap in seconds)
 * Returns { wav: ArrayBuffer, marks: [{id, start, end}], rate, duration }
 */
export async function buildSession(getWav, words, opts, onProgress) {
  const pieces = [];
  const marks = [];
  let total = 0, rate = opts.rate || 0;
  const silence = (sec) => new Int16Array(Math.round(rate * sec));
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (onProgress) onProgress(i, words.length);
    const parts = [];
    for (const [text, lang] of [[opts.cleanHe(w.he), "he"], [opts.cleanEn(w.en), "en"]]) {
      const p = parseWav(await getWav(text, lang));
      if (!rate) rate = p.rate;
      parts.push(trim(resample(p.samples, p.rate, rate), rate));
    }
    const start = total;
    const seq = [parts[0], silence(opts.pause), parts[1], silence(opts.gap)];
    for (const a of seq) { pieces.push(a); total += a.length; }
    marks.push({ id: w.id, start: start / rate, end: total / rate });
  }
  if (onProgress) onProgress(words.length, words.length);
  const all = new Int16Array(total);
  let o = 0;
  for (const a of pieces) { all.set(a, o); o += a.length; }
  return { wav: encodeWav(all, rate), marks, rate, duration: total / rate };
}

export function markIndexAt(marks, t) {
  let lo = 0, hi = marks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marks[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
