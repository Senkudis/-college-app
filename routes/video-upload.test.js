/**
 * video-upload.test.js
 * الرفع المجزّأ للفيديو: النسخ القديمة من التطبيق ترسل الملف قبل chunkIndex،
 * فكان multer يحفظ كل جزء باسم chunk-0 ويفشل الدمج "القطعة 1 مفقودة" لأي
 * فيديو أكبر من جزء واحد (5MB). الخادم يصحّح الاسم الآن بعد اكتمال الطلب.
 */
const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl, doctorToken, subjectId, batchId;

test.before(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.port}`;
});
test.after(async () => { await stopServer(); });

test("Video upload: seed", async () => {
  resetDB();
  const batch = await mongoose.model("Batch").create({ name: "دفعة الرفع", code: "UP1", status: "active" });
  batchId = batch._id;
  const { user: doctor, token } = await seedUser("دكتور الرفع", "doc_upload@elnasr.edu", "Password123!", ["doctor"]);
  doctorToken = token;
  await mongoose.model("User").findByIdAndUpdate(doctor._id, { batches: [batchId] });
  const subject = await mongoose.model("Subject").create({ name: "مادة الرفع", code: "UP101", level: 1, doctor: doctor._id, batches: [batchId] });
  subjectId = subject._id;
});

async function sendChunk(uploadId, index, bytes, indexFirst) {
  const fd = new FormData();
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  if (indexFirst) { fd.append("chunkIndex", String(index)); fd.append("chunk", blob, `chunk-${index}`); }
  else { fd.append("chunk", blob, `chunk-${index}`); fd.append("chunkIndex", String(index)); }
  const r = await fetch(`${baseUrl}/api/videos/upload-chunk/${uploadId}`, { method: "POST", headers: { Authorization: `Bearer ${doctorToken}` }, body: fd });
  return { status: r.status, body: await r.json() };
}

for (const indexFirst of [false, true]) {
  test(`Video upload: two chunks merge (${indexFirst ? "new client: index first" : "old client: file first"})`, async () => {
    const init = await fetch(`${baseUrl}/api/videos/init-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${doctorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "محاضرة", subject: String(subjectId), batches: [String(batchId)], fileName: "lec.mp4", fileSize: 8, totalChunks: 2, mimeType: "video/mp4" })
    }).then(r => r.json());
    assert.strictEqual(init.success, true, JSON.stringify(init));

    for (const [i, bytes] of [[0, "AAAA"], [1, "BBBB"]]) {
      const res = await sendChunk(init.uploadId, i, bytes, indexFirst);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    }

    const fin = await fetch(`${baseUrl}/api/videos/finalize/${init.uploadId}`, { method: "POST", headers: { Authorization: `Bearer ${doctorToken}` } });
    const body = await fin.json();
    assert.strictEqual(fin.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    const video = await mongoose.model("Video").findById(body.videoId);
    const merged = require("fs").readFileSync(video.variants.original.path, "utf8");
    assert.strictEqual(merged, "AAAABBBB", "chunks must be merged in order, none overwritten");
  });
}
