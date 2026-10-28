// توقيع iOS في GitHub Actions بدون جهاز مسجَّل وبدون Mac:
// التوقيع التلقائي في Xcode يحتاج Development profile، وهذا يتطلب جهازاً واحداً على الأقل في الحساب.
// لذلك ننشئ عبر App Store Connect API شهادة Distribution مؤقتة + App Store profile لكل تشغيل،
// ونوقّع يدوياً، ثم نحذفهما في النهاية (الحذف لا يؤثر على النسخ المرفوعة).
//
//   node scripts/ios-ci-signing.cjs setup <csr.pem> <outDir>   -> cert.cer, profile.mobileprovision, state.json
//   node scripts/ios-ci-signing.cjs profile <cert.cer> <outDir> -> profile فقط لشهادة موجودة
//   node scripts/ios-ci-signing.cjs cleanup <outDir>
//
// المتغيرات: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, PROFILE_NAME
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = 'https://api.appstoreconnect.apple.com/v1';
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.elnasrcsit.cbs';

function token() {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64u({ iss: ASC_ISSUER_ID, iat, exp: iat + 1100, aud: 'appstoreconnect-v1' })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: fs.readFileSync(ASC_KEY_PATH), dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${sig.toString('base64url')}`;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors || []).map((e) => `${e.code}: ${e.detail || e.title}`).join(' | ');
    const err = new Error(`${method} ${url} -> ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function ensureBundleId() {
  const found = await api('GET', `/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=50`);
  let item = (found.data || []).find((b) => b.attributes.identifier === BUNDLE_ID && b.attributes.platform !== 'MAC_OS');
  if (!item) {
    item = (await api('POST', '/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: 'CBS College App', platform: 'IOS' } },
    })).data;
    console.log(`Created bundle id ${BUNDLE_ID}`);
  }
  try {
    await api('POST', '/bundleIdCapabilities', {
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: { bundleId: { data: { type: 'bundleIds', id: item.id } } },
      },
    });
    console.log('Enabled Push Notifications capability');
  } catch (e) {
    if (e.status !== 409) throw e; // 409 = مفعّلة مسبقاً
  }
  return item.id;
}

// شهادة Distribution موجودة مسبقاً (مثلاً المشتركة مع وجيز): نجد معرّفها وننشئ profile فقط،
// ولا تُحذف الشهادة في cleanup لأن state.json لا يحمل certId
async function profileForExisting(cerPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const bundleRef = await ensureBundleId();
  const content = fs.readFileSync(cerPath).toString('base64');
  const list = await api('GET', '/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=50');
  const cert = (list.data || []).find((c) => c.attributes.certificateContent === content);
  if (!cert) throw new Error('الشهادة في DIST_CERT_P12_BASE64 غير موجودة (أو أُلغيت) في حساب Apple.');
  await createProfile(bundleRef, cert.id, outDir, {});
}

async function createProfile(bundleRef, certId, outDir, state) {
  const profile = (await api('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: process.env.PROFILE_NAME, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleRef } },
        certificates: { data: [{ type: 'certificates', id: certId }] },
      },
    },
  })).data;
  fs.writeFileSync(path.join(outDir, 'profile.mobileprovision'), Buffer.from(profile.attributes.profileContent, 'base64'));
  state.profileId = profile.id;
  state.profileUuid = profile.attributes.uuid;
  fs.writeFileSync(path.join(outDir, 'state.json'), JSON.stringify(state));
  console.log(`Certificate ${certId}, profile "${process.env.PROFILE_NAME}" (${profile.attributes.uuid})`);
}

async function setup(csrPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const bundleRef = await ensureBundleId();

  let cert;
  try {
    cert = (await api('POST', '/certificates', {
      data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: fs.readFileSync(csrPath, 'utf8') } },
    })).data;
  } catch (e) {
    if (e.status === 409) {
      throw new Error(`${e.message}\nحساب Apple وصل الحد الأقصى لشهادات Distribution. احذف شهادة غير مستخدمة من developer.apple.com > Certificates ثم أعد التشغيل.`);
    }
    throw e;
  }
  fs.writeFileSync(path.join(outDir, 'cert.cer'), Buffer.from(cert.attributes.certificateContent, 'base64'));
  const state = { certId: cert.id };
  fs.writeFileSync(path.join(outDir, 'state.json'), JSON.stringify(state));
  await createProfile(bundleRef, cert.id, outDir, state);
}

async function cleanup(outDir) {
  const file = path.join(outDir, 'state.json');
  if (!fs.existsSync(file)) return;
  const { certId, profileId } = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [kind, id] of [['profiles', profileId], ['certificates', certId]]) {
    if (!id) continue;
    try { await api('DELETE', `/${kind}/${id}`); console.log(`Deleted ${kind} ${id}`); }
    catch (e) { console.log(`Could not delete ${kind} ${id}: ${e.message}`); }
  }
}

const [cmd, a, b] = process.argv.slice(2);
const run = { setup: () => setup(a, b), profile: () => profileForExisting(a, b), cleanup: () => cleanup(a) }[cmd];
run().catch((e) => { console.error(e.message); process.exit(1); });
