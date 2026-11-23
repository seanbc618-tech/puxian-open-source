#!/usr/bin/env bash
# Development machine only; never receives end-user images. Needs git, curl, uv.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .omr-dev public/models/omr
if [ ! -d .omr-dev/smt/.git ]; then timeout 120 git clone --no-checkout https://github.com/antoniorv6/smt .omr-dev/smt; fi
timeout 60 git -C .omr-dev/smt checkout fdeb7c371e1614f57a041a2e77895f47ff22e619 -- smt_model LICENSE
# Only allocate the positional rectangle actually addressable by the /16 encoder.
# This does not change values or weights. Do not install upstream training requirements.
python3 - <<PY
p=".omr-dev/smt/smt_model/modeling_smt.py"
s=open(p).read().replace("PositionalEncoding2D(config.d_model, config.maxh, config.maxw)","PositionalEncoding2D(config.d_model, config.maxh // 16, config.maxw // 16)")
open(p,"w").write(s)
PY
MODEL_ORIGIN=${OMR_UPSTREAM_BASE:-https://huggingface.co/antoniorv6/smt-grandstaff/resolve/2eb5a45c29d63bdf063cd0427175f57675e7da9e}
for name in config.json model.safetensors; do
 if [ ! -f ".omr-dev/$name" ]; then timeout 600 curl -fL --retry 2 "$MODEL_ORIGIN/$name" -o ".omr-dev/$name.part"; mv ".omr-dev/$name.part" ".omr-dev/$name"; fi
done
sha256sum -c scripts/omr/upstream.sha256
timeout 120 uv venv --python 3.11 --allow-existing .omr-dev/venv
timeout 600 uv pip install --python .omr-dev/venv/bin/python torch==2.15.0+cpu --index-url https://download.pytorch.org/whl/cpu
timeout 300 uv pip install --python .omr-dev/venv/bin/python transformers==4.49.0 onnx==1.23.2 numpy==2.4.6 pillow==13.0.0
# Fail on any uninitialized / unused model tensor in export.py.
timeout 180 .omr-dev/venv/bin/python scripts/omr/export.py .omr-dev/smt .omr-dev public/models/omr
node --input-type=module - <<JS
import fs from "node:fs";
const expected=JSON.parse(fs.readFileSync("src/lib/omr/manifest.json"));
const actual=JSON.parse(fs.readFileSync("public/models/omr/manifest.json"));
if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error("Export checksum differs: do not publish without reviewing exporter/tool versions and updating the pinned manifest.");
console.log("SMT export checksums verified. Model files stay outside git.");
JS
