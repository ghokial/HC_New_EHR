import fs from 'node:fs';

const required = [
  'www/index.html',
  'www/portal.js',
  'www/portal-features.js',
  'www/supabase-config.js',
  'www/healthcarology-logo.png',
  'capacitor.config.ts',
  'android',
  'ios',
];
const missing = required.filter((path) => !fs.existsSync(path));
if (missing.length) {
  console.error('Missing:', missing.join(', '));
  process.exit(1);
}

const config = fs.readFileSync('capacitor.config.ts', 'utf8');
const entry = fs.readFileSync('www/index.html', 'utf8');
const android = fs.readFileSync('android/app/build.gradle', 'utf8');
const ios = fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
if (!config.includes("appId: 'com.healthcarology.patient'")) {
  console.error('Unexpected Capacitor application ID.');
  process.exit(1);
}
if (!entry.includes('HEALTHCAROLOGY_MOBILE_PATIENT=true')) {
  console.error('Mobile entry point does not force the patient portal.');
  process.exit(1);
}
if (!android.includes('applicationId "com.healthcarology.patient"') ||
    !ios.includes('PRODUCT_BUNDLE_IDENTIFIER = com.healthcarology.patient;')) {
  console.error('Native application identifiers do not match the patient app.');
  process.exit(1);
}
console.log('Healthcarology Patient mobile package structure verified.');
