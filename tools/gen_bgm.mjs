// gen_bgm.mjs — 为《樱花树下 · Sakura Isle》合成 12.0 秒（48kHz 16-bit 双声道立体声）场景定制 BGM
// 包含：花瓣海柔波与春风底床 + 温暖治愈系和声弦垫（Gmaj9 -> A6/9 -> Bm7 -> Dmaj9）+ 樱花五声古筝/竖琴琶音 + 空灵八音盒（Celesta）主旋律 + 远空春燕清鸣 / 江户风铃 / 星夜流萤泛音 + 立体声空间混响
import fs from 'node:fs';

const SR = 48000;
const DUR = 12.0;
const N = Math.floor(SR * DUR);

const left = new Float64Array(N);
const right = new Float64Array(N);

// 确定性伪随机数
let seed = 20261112 >>> 0;
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randNorm() {
  const u1 = Math.max(1e-7, rand());
  const u2 = rand();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// ==========================================================
// 1. 花瓣海柔波与春风沙沙立体声环境底床
// ==========================================================
{
  let sL = 0.0, sR = 0.0;
  const aOcean = 0.022;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const wL = randNorm();
    const wR = randNorm();
    sL = (1.0 - aOcean) * sL + aOcean * wL;
    sR = (1.0 - aOcean) * sR + aOcean * wR;
    const surfEnv = 0.48 + 0.52 * (0.5 + 0.5 * Math.sin(2.0 * Math.PI * 0.21 * t - 0.6));
    const breezeBoost = 1.0 + 0.65 * Math.exp(-Math.pow((t - 7.8) / 1.4, 2));
    left[i]  += sL * 0.052 * surfEnv + (wL - sL) * 0.0038 * breezeBoost;
    right[i] += sR * 0.052 * surfEnv + (wR - sR) * 0.0038 * breezeBoost;
  }
}

// ==========================================================
// 2. 温暖治愈系和声弦垫（Lush Warm Pad: Gmaj9 -> A6/9 -> Bm7 -> Dmaj9）
// ==========================================================
const chords = [
  [0.0, 3.2,  [196.00, 246.94, 293.66, 369.99, 440.00]],
  [3.0, 6.4,  [220.00, 277.18, 329.63, 369.99, 493.88]],
  [6.2, 9.2,  [246.94, 293.66, 369.99, 440.00, 587.33]],
  [9.0, 12.0, [146.83, 220.00, 293.66, 369.99, 440.00]],
];
for (const [st, ed, freqs] of chords) {
  const i0 = Math.max(0, Math.floor(st * SR));
  const i1 = Math.min(N, Math.floor(ed * SR));
  const durC = ed - st;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    const pan = 0.35 + 0.30 * (k / Math.max(1, freqs.length - 1));
    const gL = Math.cos(pan * Math.PI * 0.5);
    const gR = Math.sin(pan * Math.PI * 0.5);
    for (let i = i0; i < i1; i++) {
      const segT = (i / SR) - st;
      const u = Math.max(0.0, Math.min(1.0, segT / durC));
      const env = Math.pow(Math.sin(u * Math.PI), 1.15);
      const sig1 = Math.sin(2.0 * Math.PI * f * segT);
      const sig2 = Math.sin(2.0 * Math.PI * (f * 1.0025) * segT + 0.8);
      const sub  = k === 0 ? 0.35 * Math.sin(2.0 * Math.PI * (f * 0.5) * segT) : 0.0;
      const voice = (sig1 * 0.6 + sig2 * 0.4 + sub) * env * 0.026;
      left[i]  += voice * gL;
      right[i] += voice * gR;
    }
  }
}

// ==========================================================
// 3. 樱花五声古筝/竖琴拨弦（Koto/Harp）与空灵八音盒（Celesta）
// ==========================================================
function addPluckedNote(onset, freq, dur = 1.8, amp = 0.14, pan = 0.5, isBell = false) {
  const i0 = Math.floor(onset * SR);
  if (i0 >= N) return;
  const L = Math.min(Math.floor(dur * SR), N - i0);
  const gL = Math.cos(pan * Math.PI * 0.5);
  const gR = Math.sin(pan * Math.PI * 0.5);
  const atkTime = isBell ? 0.008 : 0.014;
  const decTime = isBell ? 0.55 : 0.72;

  for (let j = 0; j < L; j++) {
    const nt = j / SR;
    const atk = Math.min(1.0, nt / atkTime);
    const dec = Math.exp(-nt / decTime);
    const env = atk * dec;
    let sig;
    if (isBell) {
      sig = (
        1.00 * Math.sin(2.0 * Math.PI * freq * nt)
        + 0.38 * Math.sin(2.0 * Math.PI * freq * 2.0 * nt) * Math.exp(-nt * 3.5)
        + 0.16 * Math.sin(2.0 * Math.PI * freq * 4.0 * nt) * Math.exp(-nt * 7.0)
        + 0.07 * Math.sin(2.0 * Math.PI * freq * 6.0 * nt) * Math.exp(-nt * 12.0)
      );
    } else {
      sig = (
        1.00 * Math.sin(2.0 * Math.PI * freq * nt)
        + 0.52 * Math.sin(2.0 * Math.PI * freq * 2.0 * nt + 0.2) * Math.exp(-nt * 2.4)
        + 0.26 * Math.sin(2.0 * Math.PI * freq * 3.0 * nt + 0.5) * Math.exp(-nt * 4.2)
        + 0.12 * Math.sin(2.0 * Math.PI * freq * 4.0 * nt + 1.1) * Math.exp(-nt * 6.8)
        + 0.06 * Math.sin(2.0 * Math.PI * freq * 5.0 * nt) * Math.exp(-nt * 9.5)
      );
    }
    const out = sig * env * amp;
    left[i0 + j]  += out * gL;
    right[i0 + j] += out * gR;
  }
}

const NOTE = {
  'G2': 98.00,  'A2': 110.00, 'B2': 123.47, 'D3': 146.83,
  'E3': 164.81, 'F#3': 185.00, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
  'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
  'D5': 587.33, 'E5': 659.25, 'F#5': 739.99, 'G5': 783.99, 'A5': 880.00, 'B5': 987.77,
  'D6': 1174.66,
};

const arpPattern = [
  [0.15, 'G2', 0.11, 0.45], [0.35, 'D3', 0.09, 0.35], [0.55, 'A3', 0.10, 0.40], [0.75, 'B3', 0.10, 0.60],
  [1.15, 'D4', 0.10, 0.35], [1.50, 'F#4', 0.10, 0.65], [1.85, 'A4', 0.10, 0.38], [2.25, 'B4', 0.09, 0.62],
  [2.65, 'F#4', 0.09, 0.42], [3.00, 'D4', 0.09, 0.58],

  [3.35, 'A2', 0.11, 0.48], [3.60, 'E3', 0.09, 0.35], [3.85, 'A3', 0.10, 0.62], [4.15, 'F#4', 0.10, 0.40],
  [4.50, 'E4', 0.09, 0.60], [4.85, 'A4', 0.10, 0.35], [5.25, 'B4', 0.10, 0.65], [5.65, 'F#4', 0.09, 0.42],
  [6.00, 'E4', 0.09, 0.55],

  [6.35, 'B2', 0.12, 0.46], [6.60, 'F#3', 0.10, 0.34], [6.85, 'B3', 0.10, 0.66], [7.10, 'D4', 0.10, 0.38],
  [7.40, 'F#4', 0.10, 0.62], [7.70, 'A4', 0.10, 0.36], [8.05, 'B4', 0.10, 0.64], [8.45, 'D5', 0.10, 0.40],
  [8.85, 'A4', 0.09, 0.58],

  [9.20, 'D3', 0.12, 0.48], [9.45, 'A3', 0.10, 0.36], [9.70, 'D4', 0.10, 0.64], [9.95, 'F#4', 0.10, 0.40],
  [10.25, 'A4', 0.10, 0.60], [10.55, 'D5', 0.11, 0.50], [10.85, 'F#5', 0.10, 0.45], [11.15, 'A5', 0.09, 0.55],
];
for (const [onset, nname, amp, pan] of arpPattern) {
  addPluckedNote(onset, NOTE[nname], 1.9, amp, pan, false);
}

const melody = [
  [0.35, 'F#5', 1.8, 0.14, 0.55],
  [0.95, 'E5',  1.6, 0.12, 0.45],
  [1.45, 'D5',  2.0, 0.14, 0.52],
  [2.15, 'B4',  1.7, 0.12, 0.42],
  [2.65, 'A4',  1.8, 0.12, 0.58],

  [3.35, 'B4',  1.6, 0.13, 0.46],
  [3.85, 'D5',  1.6, 0.13, 0.54],
  [4.35, 'E5',  2.1, 0.15, 0.44],
  [5.10, 'F#5', 1.7, 0.13, 0.58],
  [5.65, 'E5',  1.8, 0.12, 0.48],

  [6.35, 'F#5', 1.6, 0.14, 0.42],
  [6.80, 'A5',  2.2, 0.16, 0.60],
  [7.45, 'B5',  1.9, 0.15, 0.40],
  [8.05, 'A5',  1.7, 0.14, 0.56],
  [8.55, 'F#5', 1.8, 0.13, 0.45],

  [9.20, 'E5',  1.7, 0.13, 0.54],
  [9.70, 'F#5', 1.7, 0.13, 0.46],
  [10.20, 'D5', 2.4, 0.16, 0.50],
  [10.85, 'D6', 1.8, 0.09, 0.52],
];
for (const [onset, nname, dur, amp, pan] of melody) {
  addPluckedNote(onset, NOTE[nname], dur, amp, pan, false);
  addPluckedNote(onset + 0.012, NOTE[nname], dur * 1.15, amp * 0.55, 1.0 - pan, true);
}

// ==========================================================
// 4. 场景点缀音效（春燕清鸣 / 江户风铃 / 星夜流萤泛音）
// ==========================================================
function addBirdChirp(onset, f0 = 2350, f1 = 3100, dur = 0.14, amp = 0.025, pan = 0.68) {
  const i0 = Math.floor(onset * SR);
  const L = Math.min(Math.floor(dur * SR), N - i0);
  if (L <= 0) return;
  const gL = Math.cos(pan * Math.PI * 0.5);
  const gR = Math.sin(pan * Math.PI * 0.5);
  let phase = 0.0;
  for (let j = 0; j < L; j++) {
    const bt = j / SR;
    const u = bt / dur;
    const freqInst = f0 + (f1 - f0) * Math.sin(u * Math.PI) + 180.0 * Math.sin(2.0 * Math.PI * 22.0 * bt);
    phase += (2.0 * Math.PI * freqInst) / SR;
    const env = Math.pow(Math.sin(u * Math.PI), 1.6);
    const sig = Math.sin(phase) * env * amp;
    left[i0 + j]  += sig * gL;
    right[i0 + j] += sig * gR;
  }
}
addBirdChirp(0.82, 2280, 2950, 0.13, 0.022, 0.72);
addBirdChirp(0.99, 2450, 3220, 0.15, 0.024, 0.74);
addBirdChirp(2.35, 2150, 2820, 0.14, 0.018, 0.30);

const furinNotes = [
  [6.72, 2349.32, 0.030, 0.35],
  [6.81, 2959.96, 0.028, 0.65],
  [6.93, 3520.00, 0.024, 0.42],
  [7.65, 2637.02, 0.023, 0.60],
  [7.78, 3520.00, 0.020, 0.38],
];
for (const [onset, ff, famp, fpan] of furinNotes) {
  addPluckedNote(onset, ff, 1.1, famp, fpan, true);
}

const sparkleNotes = [
  [9.35, 1760.00, 0.026, 0.32],
  [9.55, 2349.32, 0.024, 0.68],
  [9.80, 2959.96, 0.022, 0.40],
];
for (const [onset, sf, samp, span] of sparkleNotes) {
  addPluckedNote(onset, sf, 1.25, samp, span, true);
}

// ==========================================================
// 5. 立体声空间混响与母带淡入淡出
// ==========================================================
const revL = new Float64Array(N);
const revR = new Float64Array(N);
const taps = [
  [Math.floor(0.079 * SR), 0.28],
  [Math.floor(0.137 * SR), 0.23],
  [Math.floor(0.219 * SR), 0.18],
  [Math.floor(0.331 * SR), 0.14],
  [Math.floor(0.479 * SR), 0.10],
  [Math.floor(0.653 * SR), 0.07],
];
for (const [dSmp, gain] of taps) {
  for (let i = dSmp; i < N; i++) {
    revL[i] += right[i - dSmp] * gain;
    revR[i] += left[i - dSmp] * gain;
  }
}

let peak = 1e-6;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn  = Math.pow(Math.min(1.0, Math.max(0.0, t / 0.45)), 1.2);
  const fadeOut = Math.pow(Math.min(1.0, Math.max(0.0, (DUR - t) / 1.15)), 1.4);
  const env = fadeIn * fadeOut;
  left[i]  = (left[i] + revL[i] * 0.52) * env;
  right[i] = (right[i] + revR[i] * 0.52) * env;
  const aL = Math.abs(left[i]), aR = Math.abs(right[i]);
  if (aL > peak) peak = aL;
  if (aR > peak) peak = aR;
}

const scale = 0.84 / peak;
const dataBytes = N * 4;
const wavBuf = Buffer.alloc(44 + dataBytes);

// RIFF WAV Header
wavBuf.write('RIFF', 0);
wavBuf.writeUInt32LE(36 + dataBytes, 4);
wavBuf.write('WAVE', 8);
wavBuf.write('fmt ', 12);
wavBuf.writeUInt32LE(16, 16);
wavBuf.writeUInt16LE(1, 20);       // PCM
wavBuf.writeUInt16LE(2, 22);       // 2 channels
wavBuf.writeUInt32LE(SR, 24);
wavBuf.writeUInt32LE(SR * 4, 28);  // byte rate
wavBuf.writeUInt16LE(4, 32);       // block align
wavBuf.writeUInt16LE(16, 34);      // bits per sample
wavBuf.write('data', 36);
wavBuf.writeUInt32LE(dataBytes, 40);

let offset = 44;
for (let i = 0; i < N; i++) {
  const sL = Math.max(-1.0, Math.min(1.0, left[i] * scale));
  const sR = Math.max(-1.0, Math.min(1.0, right[i] * scale));
  wavBuf.writeInt16LE(Math.round(sL * 32767), offset);
  wavBuf.writeInt16LE(Math.round(sR * 32767), offset + 2);
  offset += 4;
}

const outPath = process.argv[2] || 'E:\\AIGC\\html\\_build\\sakura_bgm.wav';
fs.writeFileSync(outPath, wavBuf);
console.log(`BGM written: ${outPath} (${(wavBuf.length / 1024).toFixed(0)} KB, ${DUR}s stereo)`);
