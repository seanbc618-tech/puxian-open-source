/**
 * Re-apply the microphone string and imported document types to the Capacitor
 * Info.plist. `cap sync` does not remove these keys; use this if `cap add ios`
 * is ever run again and the plist is regenerated.
 *
 * Usage: node scripts/apply-ios-plist.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyShellPolicy } from "./ios-shell-policy.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plistPath = join(root, "ios/App/App/Info.plist");
const before = readFileSync(plistPath, "utf8");
const after = applyShellPolicy(before);
if (after !== before) writeFileSync(plistPath, after);
console.log(after === before ? `unchanged ${plistPath}` : `updated ${plistPath}`);
