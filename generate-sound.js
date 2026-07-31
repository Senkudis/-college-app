/**
 * generate-sound.js
 * يولّد نغمة إشعار مخصصة لتطبيق كلية تقنية المعلومات
 * نغمة ثلاثية: Do - Mi - Sol (مثل رنّة أكاديمية راقية)
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const NUM_CHANNELS = 1;   // mono
const BITS_PER_SAMPLE = 16;

// ===== الصوت: ثلاثة نغمات متتالية مع envelope ناعم =====
// Do5 = 523.25 Hz | Mi5 = 659.26 Hz | Sol5 = 784.00 Hz
const notes = [
  { freq: 523.25, duration: 0.12, volume: 0.7 },  // Do — قصير
  { freq: 659.26, duration: 0.12, volume: 0.75 },  // Mi — قصير
  { freq: 784.00, duration: 0.28, volume: 0.85 },  // Sol — طويل (الأكثر تأثيراً)
];
const GAP = 0.04; // 40ms صمت بين النغمات

// ===== حساب إجمالي عدد العينات =====
const totalDuration = notes.reduce((s, n) => s + n.duration + GAP, 0);
const totalSamples = Math.floor(SAMPLE_RATE * totalDuration);

const pcmData = Buffer.alloc(totalSamples * 2); // 16-bit = 2 bytes per sample

let sampleIdx = 0;

for (const note of notes) {
  const noteSamples = Math.floor(SAMPLE_RATE * note.duration);
  const gapSamples  = Math.floor(SAMPLE_RATE * GAP);

  for (let i = 0; i < noteSamples; i++) {
    // Envelope: fade-in أول 15% + fade-out آخر 30%
    let env = 1.0;
    const fadeIn  = noteSamples * 0.15;
    const fadeOut = noteSamples * 0.30;
    if (i < fadeIn)                       env = i / fadeIn;
    else if (i > noteSamples - fadeOut)   env = (noteSamples - i) / fadeOut;

    const t = i / SAMPLE_RATE;
    // الصوت الأساسي + توافقية خفيفة (overtone) لإثراء الجرس
    const sample = note.volume * env * (
      0.80 * Math.sin(2 * Math.PI * note.freq * t) +
      0.15 * Math.sin(2 * Math.PI * note.freq * 2 * t) +
      0.05 * Math.sin(2 * Math.PI * note.freq * 3 * t)
    );

    const val = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
    pcmData.writeInt16LE(val, sampleIdx * 2);
    sampleIdx++;
  }

  // صمت بين النغمات
  for (let i = 0; i < gapSamples && sampleIdx < totalSamples; i++) {
    pcmData.writeInt16LE(0, sampleIdx * 2);
    sampleIdx++;
  }
}

// ===== بناء WAV header =====
const dataSize   = sampleIdx * 2;
const byteRate   = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

const header = Buffer.alloc(44);
header.write('RIFF',                0);
header.writeUInt32LE(36 + dataSize, 4);
header.write('WAVE',                8);
header.write('fmt ',               12);
header.writeUInt32LE(16,           16); // PCM chunk size
header.writeUInt16LE(1,            20); // PCM format
header.writeUInt16LE(NUM_CHANNELS, 22);
header.writeUInt32LE(SAMPLE_RATE,  24);
header.writeUInt32LE(byteRate,     28);
header.writeUInt16LE(blockAlign,   32);
header.writeUInt16LE(BITS_PER_SAMPLE, 34);
header.write('data',               36);
header.writeUInt32LE(dataSize,     40);

const wavBuffer = Buffer.concat([header, pcmData.slice(0, dataSize)]);

// ===== الحفظ في مجلدين: res/raw + public/sounds =====
const outPaths = [
  path.join(__dirname, 'android', 'app', 'src', 'main', 'res', 'raw'),
  path.join(__dirname, 'public', 'sounds'),
];

for (const dir of outPaths) {
  fs.mkdirSync(dir, { recursive: true });

  // النغمة العامة
  fs.writeFileSync(path.join(dir, 'cbs_notif.wav'), wavBuffer);
  console.log('✅ Created: ' + path.join(dir, 'cbs_notif.wav'));
}

// ===== نغمة طارئة أسرع وأعلى =====
const emergencyNotes = [
  { freq: 880.00, duration: 0.08, volume: 0.9 },
  { freq: 880.00, duration: 0.08, volume: 0.9 },
  { freq: 1046.5, duration: 0.20, volume: 1.0 },
];
const emergencyDuration = emergencyNotes.reduce((s, n) => s + n.duration + 0.03, 0);
const emergencySamples  = Math.floor(SAMPLE_RATE * emergencyDuration);
const emergencyPcm      = Buffer.alloc(emergencySamples * 2);

let eIdx = 0;
for (const note of emergencyNotes) {
  const noteSamples = Math.floor(SAMPLE_RATE * note.duration);
  const gapSamples  = Math.floor(SAMPLE_RATE * 0.03);
  for (let i = 0; i < noteSamples && eIdx < emergencySamples; i++) {
    let env = 1.0;
    const fadeIn  = noteSamples * 0.1;
    const fadeOut = noteSamples * 0.25;
    if (i < fadeIn)                      env = i / fadeIn;
    else if (i > noteSamples - fadeOut)  env = (noteSamples - i) / fadeOut;
    const t = i / SAMPLE_RATE;
    const s = note.volume * env * (
      0.75 * Math.sin(2 * Math.PI * note.freq * t) +
      0.20 * Math.sin(2 * Math.PI * note.freq * 2 * t) +
      0.05 * Math.sin(2 * Math.PI * note.freq * 3 * t)
    );
    emergencyPcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), eIdx * 2);
    eIdx++;
  }
  for (let i = 0; i < gapSamples && eIdx < emergencySamples; i++) {
    emergencyPcm.writeInt16LE(0, eIdx * 2);
    eIdx++;
  }
}

const eDataSize = eIdx * 2;
const eHeader   = Buffer.alloc(44);
eHeader.write('RIFF',                0);
eHeader.writeUInt32LE(36 + eDataSize, 4);
eHeader.write('WAVE',                8);
eHeader.write('fmt ',               12);
eHeader.writeUInt32LE(16,           16);
eHeader.writeUInt16LE(1,            20);
eHeader.writeUInt16LE(1,            22);
eHeader.writeUInt32LE(SAMPLE_RATE,  24);
eHeader.writeUInt32LE(byteRate,     28);
eHeader.writeUInt16LE(blockAlign,   32);
eHeader.writeUInt16LE(BITS_PER_SAMPLE, 34);
eHeader.write('data',               36);
eHeader.writeUInt32LE(eDataSize,    40);

const eWav = Buffer.concat([eHeader, emergencyPcm.slice(0, eDataSize)]);

for (const dir of outPaths) {
  fs.writeFileSync(path.join(dir, 'cbs_emergency.wav'), eWav);
  console.log('✅ Created: ' + path.join(dir, 'cbs_emergency.wav'));
}

console.log('\n🎵 النغمات جاهزة!');
console.log('   cbs_notif.wav    — نغمة عادية (Do-Mi-Sol)');
console.log('   cbs_emergency.wav — نغمة طارئة (La-La-Do)');
