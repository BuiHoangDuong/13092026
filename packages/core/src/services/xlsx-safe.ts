import { createInflateRaw } from "node:zlib";

const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_ENTRIES = 64;

type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function listEntries(bytes: Buffer): ZipEntry[] {
  const min = Math.max(0, bytes.length - 22 - 65_535);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail("XLSX archive is not a valid workbook");
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount > MAX_ENTRIES || directoryOffset >= bytes.length) fail("Workbook archive is empty or too large");
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) fail("XLSX archive is not a valid workbook");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) fail("Decompressed workbook exceeds 50 MiB");
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateCapped(data: Buffer, cap: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const inflate = createInflateRaw();
    const chunks: Buffer[] = [];
    let total = 0;
    inflate.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        inflate.destroy(new Error("Decompressed workbook exceeds 50 MiB"));
        return;
      }
      chunks.push(chunk);
    });
    inflate.on("error", reject);
    inflate.on("end", () => resolve(Buffer.concat(chunks)));
    inflate.end(data);
  });
}

async function readEntry(bytes: Buffer, entry: ZipEntry, budget: { left: number }) {
  if ((entry.flags & 1) !== 0) fail("Encrypted workbooks are not allowed");
  if (entry.uncompressedSize > budget.left) fail("Decompressed workbook exceeds 50 MiB");
  if (entry.localOffset + 30 > bytes.length || bytes.readUInt32LE(entry.localOffset) !== 0x04034b50) fail("XLSX archive is not a valid workbook");
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) fail("XLSX archive is not a valid workbook");
  const compressed = bytes.subarray(start, end);
  const out = entry.method === 0 ? Buffer.from(compressed) : entry.method === 8 ? await inflateCapped(compressed, entry.uncompressedSize) : fail("Unsupported XLSX compression");
  if (out.length > budget.left) fail("Decompressed workbook exceeds 50 MiB");
  budget.left -= out.length;
  return out;
}

/** Reject zip bombs, macros, external links and formula cells before a workbook reader runs. */
export async function assertSafeXlsx(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) fail("XLSX archive is not a valid workbook");
  const entries = listEntries(buffer);
  const budget = { left: MAX_UNCOMPRESSED };
  let worksheets = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > budget.left) fail("Decompressed workbook exceeds 50 MiB");
    budget.left -= entry.uncompressedSize;
    const name = entry.name.replaceAll("\\", "/").toLowerCase();
    if (name.includes("vbaproject") || name.includes("externallink")) fail("Macros and external links are not allowed");
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) worksheets += 1;
  }
  budget.left = MAX_UNCOMPRESSED;
  if (worksheets !== 1) fail("Workbook must contain exactly one worksheet");
  const workbook = entries.find((entry) => entry.name.replaceAll("\\", "/").toLowerCase() === "xl/workbook.xml");
  const sheet = entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name.replaceAll("\\", "/")));
  const contentTypes = entries.find((entry) => entry.name.replaceAll("\\", "/").toLowerCase() === "[content_types].xml");
  if (!workbook || !sheet) fail("Workbook must contain exactly one worksheet");
  // Inflate every entry against the cap: declared sizes can lie, and the workbook reader inflates all of them.
  const contents = new Map<ZipEntry, Buffer>();
  for (const entry of entries) {
    const out = await readEntry(buffer, entry, budget);
    if (entry === workbook || entry === sheet || entry === contentTypes) contents.set(entry, out);
  }
  if (contentTypes) {
    const types = (contents.get(contentTypes) ?? Buffer.alloc(0)).toString("utf8").toLowerCase();
    if (types.includes("macroenabled") || types.includes("vbaproject")) fail("Macros and external links are not allowed");
  }
  const workbookXml = (contents.get(workbook) ?? Buffer.alloc(0)).toString("utf8");
  const sheetCount = workbookXml.match(/<sheet\b/g)?.length ?? 0;
  if (sheetCount !== 1) fail("Workbook must contain exactly one worksheet");
  const sheetXml = (contents.get(sheet) ?? Buffer.alloc(0)).toString("utf8");
  if (/<f[\s/>]/.test(sheetXml)) fail("Spreadsheet formulas are not allowed");
}
