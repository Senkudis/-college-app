/**
 * transcode.js — FFmpeg Transcoding Utility
 * 
 * Generates:
 *   1. Low-res variant (360p MP4, H.264+AAC, CRF 28)
 *   2. Audio-only variant (MP3, 128kbps)
 *   3. Thumbnail (JPG from 3 second mark)
 *   4. Extracts duration via ffprobe
 * 
 * Designed for low-bandwidth regions — aggressive compression for small file sizes.
 */

const path = require("path");
const fs   = require("fs");

let ffmpeg, ffprobe;

// Graceful fallback if fluent-ffmpeg is not installed
try {
  ffmpeg  = require("fluent-ffmpeg");
} catch (e) {
  console.warn("⚠️  fluent-ffmpeg not installed. Transcoding will be disabled.");
  console.warn("   Run: npm install fluent-ffmpeg");
}

/**
 * Get video duration using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {Promise<number>} Duration in seconds
 */
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return resolve(0);
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return resolve(0); // graceful fallback
      resolve(Math.floor(metadata.format.duration || 0));
    });
  });
}

/**
 * Generate a thumbnail from the video
 * @param {string} inputPath - Source video
 * @param {string} outputDir - Directory to save thumbnail
 * @returns {Promise<string>} Path to generated thumbnail
 */
function generateThumbnail(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return resolve("");

    const thumbName = "thumb.jpg";
    const thumbPath = path.join(outputDir, thumbName);

    ffmpeg(inputPath)
      .on("end", () => resolve(thumbPath))
      .on("error", (err) => {
        console.error("Thumbnail generation failed:", err.message);
        resolve(""); // don't fail the whole pipeline
      })
      .screenshots({
        count: 1,
        timemarks: ["3"],    // 3 seconds in
        folder: outputDir,
        filename: thumbName,
        size: "640x360"
      });
  });
}

/**
 * Transcode to low-res 360p MP4
 * Aggressive compression for low-bandwidth users.
 * 
 * @param {string} inputPath - Source video
 * @param {string} outputDir - Directory to save output
 * @returns {Promise<{path: string, size: number}>}
 */
function transcodeLowRes(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return resolve({ path: "", size: 0 });

    const outPath = path.join(outputDir, "360p.mp4");

    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate("96k")
      .size("640x360")
      .outputOptions([
        "-crf 28",           // high compression, decent quality for educational content
        "-preset veryfast",  // fast encoding, slightly larger file
        "-movflags +faststart", // enable progressive download / streaming
        "-pix_fmt yuv420p",  // max compatibility
        "-r 24"              // 24 fps is enough for lectures
      ])
      .output(outPath)
      .on("end", () => {
        const stats = fs.statSync(outPath);
        resolve({ path: outPath, size: stats.size });
      })
      .on("error", (err) => {
        console.error("360p transcode failed:", err.message);
        resolve({ path: "", size: 0 });
      })
      .run();
  });
}

/**
 * Extract audio-only MP3
 * "Podcast Mode" — ultra low data usage for students on poor connections.
 * 
 * @param {string} inputPath - Source video
 * @param {string} outputDir - Directory to save output
 * @returns {Promise<{path: string, size: number}>}
 */
function extractAudio(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return resolve({ path: "", size: 0 });

    const outPath = path.join(outputDir, "audio.mp3");

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .output(outPath)
      .on("end", () => {
        const stats = fs.statSync(outPath);
        resolve({ path: outPath, size: stats.size });
      })
      .on("error", (err) => {
        console.error("Audio extraction failed:", err.message);
        resolve({ path: "", size: 0 });
      })
      .run();
  });
}

/**
 * Main transcoding pipeline — runs all jobs sequentially to avoid
 * overwhelming the server (especially important for low-resource VPS).
 * 
 * @param {string} inputPath - Path to the original merged video file
 * @param {string} outputDir - Directory for all output files
 * @returns {Promise<Object>} Results with paths, sizes, duration
 */
async function processVideo(inputPath, outputDir) {
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const results = {
    duration: 0,
    thumbnailPath: "",
    low: { path: "", size: 0 },
    audioOnly: { path: "", size: 0 }
  };

  if (!ffmpeg) {
    console.warn("⚠️  FFmpeg not available — skipping transcoding.");
    return results;
  }

  console.log(`🎬 Starting transcoding pipeline for: ${inputPath}`);

  // Step 1: Get duration
  results.duration = await getDuration(inputPath);
  console.log(`   ⏱️  Duration: ${results.duration}s`);

  // Step 2: Generate thumbnail
  results.thumbnailPath = await generateThumbnail(inputPath, outputDir);
  console.log(`   🖼️  Thumbnail: ${results.thumbnailPath ? "OK" : "SKIPPED"}`);

  // Step 3: Transcode to 360p
  results.low = await transcodeLowRes(inputPath, outputDir);
  console.log(`   📹  360p: ${results.low.path ? (results.low.size / 1024 / 1024).toFixed(1) + "MB" : "SKIPPED"}`);

  // Step 4: Extract audio
  results.audioOnly = await extractAudio(inputPath, outputDir);
  console.log(`   🎧  Audio: ${results.audioOnly.path ? (results.audioOnly.size / 1024 / 1024).toFixed(1) + "MB" : "SKIPPED"}`);

  console.log(`✅ Transcoding complete for: ${path.basename(inputPath)}`);

  return results;
}

module.exports = { processVideo, getDuration, generateThumbnail, transcodeLowRes, extractAudio };
