import { describe, expect, it } from "vitest";
import * as lib from "../scripts/backup-lib.mjs";

const { foldersToDelete, shouldDownload, splitStorageEntries, backupFolderName, safeRelativePath } = lib as any;

describe("retention", () => {
  it("keeps the newest n dated folders and never touches anything else", () => {
    const names = ["2026-10-01", "2026-10-02", "2026-10-03", "storage", "notes.txt", "2026-10-04T0300"];
    expect(foldersToDelete(names, 2)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("deletes nothing when there are fewer than n", () => {
    expect(foldersToDelete(["2026-10-01"], 14)).toEqual([]);
  });
  it("a keep below 1 deletes nothing rather than everything", () => {
    expect(foldersToDelete(["2026-10-01", "2026-10-02"], 0)).toEqual([]);
  });
});

describe("storage", () => {
  it("downloads new or changed files only", () => {
    expect(shouldDownload(null, 100)).toBe(true);
    expect(shouldDownload(100, 100)).toBe(false);
    expect(shouldDownload(90, 100)).toBe(true);
    expect(shouldDownload(100, null)).toBe(true);
  });

  it("splits a listing into files and folders to open", () => {
    const { files, folders } = splitStorageEntries(
      [
        { name: "photos", id: null, metadata: null },
        { name: "logo.png", id: "abc", metadata: { size: 1234 } },
      ],
      "org1"
    );
    expect(folders).toEqual(["org1/photos"]);
    expect(files).toEqual([{ path: "org1/logo.png", size: 1234 }]);
  });

  it("works at the top of a bucket", () => {
    expect(splitStorageEntries([{ name: "a.txt", id: "1", metadata: { size: 5 } }], "").files[0].path).toBe("a.txt");
  });

  it("keeps paths inside the backup folder", () => {
    expect(safeRelativePath("../../etc/passwd")).toBe("etc/passwd");
    expect(safeRelativePath("/abs/./file.png")).toBe("abs/file.png");
    expect(safeRelativePath("org/photos/a b.png")).toBe("org/photos/a b.png");
  });
});

describe("folder name", () => {
  it("is the UTC date", () => {
    expect(backupFolderName(new Date("2026-10-05T23:30:00Z"))).toBe("2026-10-05");
  });
});
