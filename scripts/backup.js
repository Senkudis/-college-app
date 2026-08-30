'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceUploads = path.join(root, 'uploads');
const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(backupRoot, stamp);
const archivePath = path.join(outputDir, 'mongodb.archive.gz');
const filesPath = path.join(outputDir, 'uploads');

function fail(message) {
  console.error(`[backup] ${message}`);
  process.exitCode = 1;
}

if (!process.env.MONGO_URI) {
  fail('MONGO_URI is required; no backup was created.');
} else {
  fs.mkdirSync(outputDir, { recursive: true });
  const dump = spawnSync('mongodump', ['--uri', process.env.MONGO_URI, `--archive=${archivePath}`, '--gzip'], {
    cwd: root,
    stdio: 'inherit',
    shell: false
  });
  if (dump.error || dump.status !== 0) {
    fail('mongodump failed or is not installed; upload files were not copied.');
  } else {
    if (fs.existsSync(sourceUploads)) fs.cpSync(sourceUploads, filesPath, { recursive: true, force: false });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
      createdAt: new Date().toISOString(),
      appVersion: pkg.version,
      databaseArchive: path.basename(archivePath),
      uploadsDirectory: fs.existsSync(filesPath) ? 'uploads' : null,
      restoreRequiresExplicitConfirmation: true
    }, null, 2) + '\n');
    console.log(`[backup] created ${outputDir}`);
  }
}
