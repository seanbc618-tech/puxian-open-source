import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  APP_ID,
  APP_NAME,
  CAPACITOR_VERSION,
  FORBIDDEN_OPEN_TYPES,
  MIC_USAGE,
  OPEN_CONTENT_TYPES,
  WEB_DIR,
  filenameExtensions,
  openContentTypes,
  shellPolicyXml,
} from "./ios-shell-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("capacitor config points the iOS shell at dist-static", () => {
  const config = read("capacitor.config.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(config, new RegExp(`appId:\\s*"${APP_ID}"`));
  assert.match(config, new RegExp(`appName:\\s*"${APP_NAME}"`));
  assert.match(config, new RegExp(`webDir:\\s*"${WEB_DIR}"`));
  assert.match(config, /iosScheme:\s*"capacitor"/);
  assert.doesNotMatch(config, /url\s*:/);
  assert.doesNotMatch(config, /webDir:\s*"(?:\.output|\.vercel|dist)"/);
  assert.doesNotMatch(config, /android/);
});

test("package.json installs Capacitor 8 for iOS only", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["@capacitor/core"], CAPACITOR_VERSION);
  assert.equal(pkg.dependencies["@capacitor/ios"], CAPACITOR_VERSION);
  assert.equal(pkg.dependencies["@capacitor/cli"], undefined);
  assert.equal(pkg.dependencies["@capacitor/android"], undefined);
  assert.equal(pkg.devDependencies["@capacitor/cli"], CAPACITOR_VERSION);
  assert.equal(pkg.devDependencies["@capacitor/android"], undefined);
  for (const name of ["@capacitor/filesystem", "@capacitor/share", "@capacitor/preferences"]) {
    assert.equal(pkg.dependencies[name], undefined, name);
    assert.equal(pkg.devDependencies[name], undefined, name);
  }
  assert.match(pkg.scripts["build:static"], /vite\.static\.config\.ts/);
  assert.match(pkg.scripts.build, /vite build && npm run db:migrate/);
});

test("locked Capacitor packages are MIT and not GPL", () => {
  const lock = JSON.parse(read("package-lock.json"));
  for (const name of ["@capacitor/core", "@capacitor/cli", "@capacitor/ios"]) {
    const meta = lock.packages[`node_modules/${name}`];
    assert.ok(meta, name);
    assert.equal(meta.version, CAPACITOR_VERSION);
    assert.equal(meta.license, "MIT");
  }
  assert.equal(lock.packages["node_modules/@capacitor/android"], undefined);
});

test("iOS project is SPM, with no Android project and no background audio", () => {
  assert.equal(existsSync(join(root, "ios/App/App.xcodeproj/project.pbxproj")), true);
  assert.equal(existsSync(join(root, "ios/App/CapApp-SPM/Package.swift")), true);
  assert.equal(existsSync(join(root, "ios/App/Podfile")), false);
  assert.equal(existsSync(join(root, "android")), false);
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(pbx, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID};`));
  assert.doesNotMatch(pbx, /UIBackgroundModes/);
  const plist = read("ios/App/App/Info.plist");
  assert.doesNotMatch(plist, /UIBackgroundModes/);
  assert.doesNotMatch(plist, /NSCameraUsageDescription/);
  assert.doesNotMatch(plist, /NSPhotoLibraryUsageDescription/);
  assert.doesNotMatch(plist, /NSSpeechRecognitionUsageDescription/);
});

test("Info.plist states local dictation and imported document types only", () => {
  const plist = read("ios/App/App/Info.plist");
  assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>zh-Hans<\/string>/);
  assert.match(plist, new RegExp(`<string>${APP_NAME}</string>`));
  assert.match(plist, new RegExp(`<string>${MIC_USAGE}</string>`));
  assert.doesNotMatch(plist, /不会上传/);
  assert.doesNotMatch(plist, /UTExportedTypeDeclarations/);
  assert.match(plist, /UTImportedTypeDeclarations/);
  assert.match(plist, /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<false\/>/);
  assert.deepEqual(openContentTypes(plist), OPEN_CONTENT_TYPES);
  for (const forbidden of FORBIDDEN_OPEN_TYPES) {
    assert.equal(openContentTypes(plist).includes(forbidden), false, forbidden);
  }
  assert.deepEqual(filenameExtensions(plist).sort(), ["jpwabc", "musicxml", "mxl"]);
  assert.equal(plist.includes(shellPolicyXml()), true);
  const native = read("ios/App/App/capacitor.config.json");
  const copied = JSON.parse(native);
  assert.equal(copied.webDir, WEB_DIR);
  assert.equal(copied.appId, APP_ID);
  assert.equal(copied.server?.url, undefined);
});

test("the Chinese checklist keeps the device matrix unchecked", () => {
  const doc = read("docs/capacitor-ios-verify.md");
  assert.match(doc, new RegExp(MIC_USAGE));
  assert.match(doc, /没有 Xcode/);
  assert.match(doc, /- \[ \]/);
  assert.match(doc, new RegExp(WEB_DIR));
  assert.doesNotMatch(doc, /设备矩阵已通过/);
});

test("the static entry mounts home without auth or Capacitor plugins", () => {
  const main = read("static/main.tsx");
  assert.match(main, /<HomeApp \/>/);
  assert.doesNotMatch(main, /@capacitor\//);
  assert.doesNotMatch(main, /preview-host-bridge/);
  assert.doesNotMatch(main, /@\/lib\/auth/);
  assert.doesNotMatch(read("src/lib/music/foreground-audio.ts"), /@capacitor\//);
});
