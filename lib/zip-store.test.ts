import { describe, it, expect } from "vitest";
import { crc32 } from "node:zlib";
import { csvLine, utf8, zipParts, type ZipEntry } from "./zip-store";

async function collect(entries: ZipEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of zipParts(entries)) parts.push(p);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Reads the archive back through its central directory, the way an unzip program does.
function readZip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const files: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const offset = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLen));
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    const localNameLen = v.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLen;
    const data = bytes.slice(start, start + size);
    // the data descriptor follows the data and repeats the numbers
    expect(v.getUint32(start + size, true)).toBe(0x08074b50);
    expect(v.getUint32(start + size + 4, true)).toBe(crc);
    expect(v.getUint32(start + size + 8, true)).toBe(size);
    files.push({ name, data, crc });
    at += 46 + nameLen;
  }
  return files;
}

async function* chunks(...texts: string[]) {
  for (const t of texts) yield utf8(t);
}

describe("zip-store", () => {
  it("writes files that read back by name, content and CRC (checked against the platform's own CRC)", async () => {
    const zip = await collect([
      { name: "a.csv", chunks: chunks("id,name\r\n", "1,Jane\r\n") },
      { name: "empty.csv", chunks: chunks() },
      { name: "naïve/ünï.txt", chunks: chunks("héllo") },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["a.csv", "empty.csv", "naïve/ünï.txt"]);
    expect(new TextDecoder().decode(files[0].data)).toBe("id,name\r\n1,Jane\r\n");
    expect(files[1].data.length).toBe(0);
    for (const f of files) expect(f.crc).toBe(crc32(f.data));
  });

  it("an archive with no files is still a valid archive", async () => {
    expect(readZip(await collect([]))).toEqual([]);
  });

  it("csvLine quotes commas, quotes and line breaks, and defuses spreadsheet formulas", () => {
    expect(csvLine(["a", "b,c", 'say "hi"', "line\nbreak", null, 5])).toBe('a,"b,c","say ""hi""","line\nbreak",,5\r\n');
    expect(csvLine(["=SUM(A1)", "+1", "@x", "-cmd", "-5"])).toBe("'=SUM(A1),'+1,'@x,'-cmd,-5\r\n");
  });
});
