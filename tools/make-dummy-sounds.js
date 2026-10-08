// 더미 효과음 생성기: node tools/make-dummy-sounds.js
// public/sounds/ 에 bid / sold / unsold / tick .wav 를 만든다. (실제 효과음으로 교체 전까지 임시 사용)
import fs from 'node:fs';

const RATE = 44100;
function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), 44 + i * 2));
  return buf;
}
/** 음 하나: 주파수(시작→끝), 길이, 시작 시각, 감쇠 */
function render(totalSec, notes) {
  const out = new Float32Array(Math.ceil(totalSec * RATE));
  for (const n of notes) {
    const start = Math.floor(n.at * RATE), len = Math.floor(n.dur * RATE);
    let phase = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / len;
      const f = n.f + ((n.f2 ?? n.f) - n.f) * t;
      phase += (2 * Math.PI * f) / RATE;
      const attack = Math.min(1, i / (0.004 * RATE));
      const env = attack * Math.pow(1 - t, n.decay ?? 2);
      const wave = n.square ? Math.sign(Math.sin(phase)) * 0.5 : Math.sin(phase) + 0.25 * Math.sin(phase * 2);
      out[start + i] += wave * env * (n.gain ?? 0.5);
    }
  }
  return out;
}

const sounds = {
  // 입찰: 짧고 밝은 두 번 '띠링'
  bid: render(0.22, [
    { f: 1046, at: 0, dur: 0.09, gain: 0.45 },
    { f: 1568, at: 0.07, dur: 0.15, gain: 0.45 },
  ]),
  // 낙찰: 올라가는 화음 + 반짝임
  sold: render(1.3, [
    { f: 523, at: 0.00, dur: 0.5, gain: 0.35 },
    { f: 659, at: 0.09, dur: 0.5, gain: 0.35 },
    { f: 784, at: 0.18, dur: 0.6, gain: 0.35 },
    { f: 1046, at: 0.27, dur: 1.0, gain: 0.4, decay: 1.5 },
    { f: 2093, at: 0.35, dur: 0.6, gain: 0.12, decay: 3 },
  ]),
  // 유찰: 내려가는 낮은 음
  unsold: render(0.8, [
    { f: 392, f2: 196, at: 0, dur: 0.7, gain: 0.3, square: true, decay: 1.5 },
    { f: 294, f2: 147, at: 0.05, dur: 0.7, gain: 0.25, decay: 1.5 },
  ]),
  // 타이머 틱: 아주 짧은 클릭
  tick: render(0.05, [{ f: 1800, at: 0, dur: 0.035, gain: 0.5, decay: 4 }]),
};

for (const [name, s] of Object.entries(sounds)) {
  fs.writeFileSync(new URL(`../public/sounds/${name}.wav`, import.meta.url), wav(s));
  console.log(`public/sounds/${name}.wav`);
}
