import { Inflate } from "fflate";
import { musicXmlToScore } from "./musicxml.ts";

export const MAX_MXL_BYTES = 16 * 1024 * 1024;
const noted = (message: string) => message.includes("现有谱未更改");
export function formatImportError(err: unknown, fallback = "MusicXML 读不了"): string {
  const raw = err instanceof Error && err.message.trim() ? err.message : fallback;
  return noted(raw) ? raw : `${raw}，现有谱未更改。`;
}
const fail = (message = "这不是有效的压缩 MusicXML（.mxl）"): never => {
  throw new Error(formatImportError(new Error(message), message));
};
const safePath = (s: string) => {
  if (!s || s.includes("\\") || s.includes("\0") || s.startsWith("/") || s.includes(":")) return false;
  const parts = s.split("/");
  return parts.every(Boolean) && !parts.some((part) => part === ".." || part === ".");
};
function crc32(data: Uint8Array) {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
/** Inspect the central directory before allocating any expanded file. ZIP64 and encryption are deliberately unsupported. */
export function unpackMxl(bytes: Uint8Array): string {
  if (bytes.length > MAX_MXL_BYTES) fail(".mxl 文件过大，请使用不超过 16 MB 的文件");
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (p: number) => v.getUint16(p, true),
      u32 = (p: number) => v.getUint32(p, true);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
    if (end < 0 || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length) fail();
    const count = u16(end + 10),
      offset = u32(end + 16);
    if (
      u16(end + 4) ||
      u16(end + 6) ||
      count !== u16(end + 8) ||
      count > 256 ||
      !count ||
      offset + u32(end + 12) !== end
    )
      fail();
    const files = new Map<
      string,
      { start: number; packed: number; size: number; method: number; crc: number }
    >();
    let pos = offset,
      total = 0;
    for (let i = 0; i < count; i++) {
      if (u32(pos) !== 0x02014b50) fail();
      const flags = u16(pos + 8),
        method = u16(pos + 10),
        packed = u32(pos + 20),
        size = u32(pos + 24);
      const nameLen = u16(pos + 28),
        local = u32(pos + 42);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(pos + 46, pos + 46 + nameLen),
      );
      total += size;
      if (total > MAX_MXL_BYTES || size > MAX_MXL_BYTES || size > Math.max(1, packed) * 200)
        fail(".mxl 解压后过大或压缩比过高，已拒绝");
      if (
        !safePath(name) ||
        files.has(name) ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        u16(pos + 34)
      )
        fail();
      if (u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags)
        fail();
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      const localName = new TextDecoder().decode(
        bytes.subarray(local + 30, local + 30 + u16(local + 26)),
      );
      if (localName !== name || start + packed > offset || (method === 0 && packed !== size))
        fail();
      files.set(name, { start, packed, size, method, crc: u32(pos + 16) });
      pos += 46 + nameLen + u16(pos + 30) + u16(pos + 32);
    }
    if (pos !== end) fail();
    const read = (name: string) => {
      const f = files.get(name);
      if (!f) return fail(".mxl 缺少谱面文件或 container.xml");
      const data = bytes.subarray(f.start, f.start + f.packed);
      // Feed bounded chunks and stop as soon as the actual output exceeds its declaration.
      let out: Uint8Array = data;
      if (f.method === 8) {
        out = new Uint8Array(f.size);
        let expanded = 0;
        const stream = new Inflate((chunk) => {
          expanded += chunk.length;
          if (expanded > f.size || expanded > MAX_MXL_BYTES) fail(".mxl 解压后过大，已拒绝");
          out.set(chunk, expanded - chunk.length);
        });
        for (let p = 0; p < data.length; p += 256)
          stream.push(data.subarray(p, p + 256), p + 256 >= data.length);
        if (expanded !== f.size) fail();
      }
      if (out.length !== f.size || crc32(out) !== f.crc) fail();
      if (out[0] === 80 && out[1] === 75) fail(".mxl 不支持嵌套压缩包");
      return new TextDecoder("utf-8", { fatal: true }).decode(out);
    };
    const container = new DOMParser().parseFromString(
      read("META-INF/container.xml"),
      "application/xml",
    );
    if (
      container.querySelector("parsererror") ||
      container.documentElement.localName !== "container"
    )
      fail();
    const roots = [...container.getElementsByTagNameNS("*", "rootfile")];
    const candidates = roots.filter((r) => safePath(r.getAttribute("full-path") ?? ""));
    if (candidates.length !== roots.length || !candidates.length) fail(".mxl 缺少合法 rootfile");
    const root =
      candidates.find(
        (r) => r.getAttribute("media-type") === "application/vnd.recordare.musicxml+xml",
      ) ?? candidates[0];
    return read(root.getAttribute("full-path")!);
  } catch (err) {
    if (err instanceof Error && err.message.includes("现有谱未更改")) throw err;
    return fail();
  }
}
export function importMusicXmlSource(bytes: Uint8Array, fallbackTitle: string, compressed = false) {
  if (bytes.length > MAX_MXL_BYTES) fail("MusicXML 文件过大，请使用不超过 16 MB 的文件");
  try {
    return musicXmlToScore(
      compressed || (bytes[0] === 80 && bytes[1] === 75)
        ? unpackMxl(bytes)
        : new TextDecoder().decode(bytes),
      fallbackTitle,
    );
  } catch (err) {
    if (err instanceof Error && noted(err.message)) throw err;
    return fail(err instanceof Error ? err.message : "MusicXML 读不了");
  }
}
