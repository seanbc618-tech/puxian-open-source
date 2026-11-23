import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
test("feedback originals stay byte-for-byte identical to the archived reference hashes", () => {
  const manifest = JSON.parse(readFileSync("eval/reference/sha256.json", "utf8"));
  for (const [file, expected] of Object.entries(manifest))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(`eval/reference/${file}`))
        .digest("hex"),
      expected,
      file,
    );
});
