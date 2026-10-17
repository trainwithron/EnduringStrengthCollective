// A streaming ZIP writer with no compression ("stored"), so a large export is sent as it is made instead of being built in memory first (and past the size a single response can hold). Each file is written with a
// data descriptor after it (its CRC and size are only known at the end), file names are UTF-8, and a central directory closes the archive. Files under 4 GB, fewer than 65,535 of them. Pure.

export interface ZipEntry {
  name: string;
  chunks: AsyncIterable<Uint8Array>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function u16(view: DataView, at: number, v: number) {
  view.setUint16(at, v, true);
}
function u32(view: DataView, at: number, v: number) {
  view.setUint32(at, v >>> 0, true);
}

export async function* zipParts(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, now: Date = new Date()): AsyncGenerator<Uint8Array> {
  const stamp = dosDateTime(now);
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;
  const emit = (b: Uint8Array) => {
    offset += b.length;
    return b;
  };

  for await (const entry of entries) {
    const name = enc.encode(entry.name);
    const startOffset = offset;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed
    u16(lv, 6, 0x0808); // data descriptor follows + UTF-8 names
    u16(lv, 8, 0); // stored
    u16(lv, 10, stamp.time);
    u16(lv, 12, stamp.date);
    u32(lv, 14, 0);
    u32(lv, 18, 0);
    u32(lv, 22, 0);
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    local.set(name, 30);
    yield emit(local);

    let crc = 0;
    let size = 0;
    for await (const chunk of entry.chunks) {
      if (chunk.length === 0) continue;
      crc = crc32Update(crc, chunk);
      size += chunk.length;
      yield emit(chunk);
    }

    const desc = new Uint8Array(16);
    const dv = new DataView(desc.buffer);
    u32(dv, 0, 0x08074b50);
    u32(dv, 4, crc);
    u32(dv, 8, size);
    u32(dv, 12, size);
    yield emit(desc);
    central.push({ name, crc, size, offset: startOffset });
  }

  const cdStart = offset;
  for (const f of central) {
    const rec = new Uint8Array(46 + f.name.length);
    const v = new DataView(rec.buffer);
    u32(v, 0, 0x02014b50);
    u16(v, 4, 20);
    u16(v, 6, 20);
    u16(v, 8, 0x0808);
    u16(v, 10, 0);
    u16(v, 12, stamp.time);
    u16(v, 14, stamp.date);
    u32(v, 16, f.crc);
    u32(v, 20, f.size);
    u32(v, 24, f.size);
    u16(v, 28, f.name.length);
    u32(v, 42, f.offset);
    rec.set(f.name, 46);
    yield emit(rec);
  }
  const cdSize = offset - cdStart;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, central.length);
  u16(ev, 10, central.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, cdStart);
  yield emit(end);
}

// The archive as a web stream a route can return: parts are pulled only as fast as the client takes them.
export function zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): ReadableStream<Uint8Array> {
  const it = zipParts(entries)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}

export function utf8(text: string): Uint8Array {
  return enc.encode(text);
}

// One CSV line: a value with a comma, quote or line break is quoted; a value that starts with = + - @ is prefixed so a spreadsheet never runs it as a formula (the same rule Excel exports use).
export function csvLine(values: unknown[]): string {
  return (
    values
      .map((v) => {
        if (v == null) return "";
        let s = typeof v === "object" ? JSON.stringify(v) : String(v);
        // Anything a spreadsheet could run as a formula (starts with = + - @ or a tab or carriage return) gets a leading apostrophe, except a plain negative number.
        if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(?:\.\d+)?$/.test(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",") + "\r\n"
  );
}
