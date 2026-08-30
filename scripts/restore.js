'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const backupDir = path.resolve(process.argv[2] || '');
const uploadsTarget = path.join(root, 'uploads');

if (!backupDir || !fs.existsSync(backupDir)) {
  console.error('Usage: node scripts/restore.js <backup-directory> --confirm');
  process.exitCode = 1;
} else if (process.argv[3] !== '--confirm') {
  console.error('Restore is destructive. Re-run with --confirm after reviewing the backup manifest.');
  process.exitCode = 1;
} else if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is required; no restore was performed.');
  process.exitCode = 1;
} else {
  const archive = path.join(backupDir, 'mongodb.archive.gz');
  if (!fs.existsSync(archive)) {
    console.error('mongodb.archive.gz was not found; no restore was performed.');
    process.exitCode = 1;
  } else {
    const restore = spawnSync('mongorestore', ['--uri', process.env.MONGO_URI, `--archive=${archive}`, '--gzip', '--drop'], {
      cwd: root,
      stdio: 'inherit',
      shell: false
    });
    if (restore.error || restore.status !== 0) {
      console.error('[restore] mongorestore failed; uploads were not replaced.');
      process.exitCode = 1;
    } else {
      const sourceUploads = path.join(backupDir, 'uploads');
      if (fs.existsSync(sourceUploads)) {
        const current = `${uploadsTarget}.before-restore-${Date.now()}`;
        if (fs.existsSync(uploadsTarget)) fs.renameSync(uploadsTarget, current);
        fs.cpSync(sourceUploads, uploadsTarget, { recursive: true, force: false });
        console.log(`[restore] previous uploads preserved at ${current}`);
      }
      console.log('[restore] completed');
    }
  }
}
