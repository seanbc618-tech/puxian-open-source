/** Original local image preprocessing; no network or third-party CV runtime. */
export function flattenStaffImage(data: Uint8ClampedArray, width: number, height: number) {
  // Local paper estimate removes broad shadows without bleaching thin staff lines.
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      gray[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
      sum += gray[i];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  // Already straight, evenly lit scans retain their anti-aliased pixels. Hard
  // binarization can erase small accidentals and change the model's clean input.
  let left = width,
    right = 0;
  const rows = new Uint32Array(height);
  let paperSum = 0,
    paperCount = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      if (v < 230) {
        rows[y]++;
        left = Math.min(left, x);
        right = Math.max(right, x);
      } else {
        paperSum += v;
        paperCount++;
      }
    }
  let longLines = 0;
  for (let y = 0; y < height; y++) {
    if (
      rows[y] > (right - left + 1) * 0.45 &&
      (y === 0 || rows[y - 1] <= (right - left + 1) * 0.45)
    )
      longLines++;
  }
  if (longLines >= 10 && paperCount > width * height * 0.8 && paperSum / paperCount > 250)
    return data;
  const ink = new Uint8Array(gray.length);
  const radius = Math.max(16, Math.round(width / 45));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const a = Math.max(0, x - radius),
        b = Math.min(width, x + radius + 1);
      const c = Math.max(0, y - radius),
        d = Math.min(height, y + radius + 1);
      const mean =
        (integral[d * stride + b] -
          integral[c * stride + b] -
          integral[d * stride + a] +
          integral[c * stride + a]) /
        ((b - a) * (d - c));
      const i = y * width + x;
      ink[i] = gray[i] < Math.min(210, mean - 24) ? 1 : 0;
    }
  // Search staff direction, maximizing long-line projection energy. Subsample x,
  // but keep full vertical resolution so even small rotations have a sharp peak.
  function projection(x0: number, x1: number, slope: number) {
    const rows = new Float64Array(height);
    for (let x = x0; x < x1; x += 3) {
      const shift = Math.round((x - width / 2) * slope);
      for (let y = Math.max(0, -shift); y < Math.min(height, height - shift); y++)
        rows[y] += ink[(y + shift) * width + x];
    }
    return rows;
  }
  let slope = 0,
    best = -1;
  for (let step = -40; step <= 40; step++) {
    const candidate = step * 0.00125;
    const p = projection(0, width, candidate);
    const energy = p.reduce((s, v) => s + v * v * v, 0);
    if (energy > best) {
      best = energy;
      slope = candidate;
    }
  }
  const reference = projection(0, width, slope);
  const count = Math.max(3, Math.ceil(width / 180));
  const offsets: number[] = [];
  const reach = Math.min(18, Math.round(width * 0.012));
  for (let k = 0; k < count; k++) {
    const p = projection(
      Math.floor((k * width) / count),
      Math.floor(((k + 1) * width) / count),
      slope,
    );
    let score = -1,
      offset = 0;
    for (let d = -reach; d <= reach; d++) {
      let value = 0;
      for (let y = reach; y < height - reach; y++) value += p[y + d] * reference[y];
      // Mild regularization avoids octave-like jumps onto an adjacent staff line.
      value /= 1 + Math.abs(d) * 0.003;
      if (value > score) {
        score = value;
        offset = d;
      }
    }
    offsets.push(offset);
  }
  const output = new Uint8ClampedArray(data.length);
  output.fill(255);
  for (let x = 0; x < width; x++) {
    const pos = Math.max(0, Math.min(count - 1, (x * count) / width - 0.5));
    const k = Math.floor(pos),
      t = pos - k;
    const shift =
      (x - width / 2) * slope + offsets[k] * (1 - t) + offsets[Math.min(k + 1, count - 1)] * t;
    for (let y = 0; y < height; y++) {
      const sy = Math.round(y + shift);
      if (sy < 0 || sy >= height) continue;
      const i = (y * width + x) * 4;
      const value = ink[sy * width + x] ? 0 : 255;
      output[i] = output[i + 1] = output[i + 2] = value;
    }
  }
  return output;
}
