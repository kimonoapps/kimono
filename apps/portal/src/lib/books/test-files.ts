import "server-only";

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../state";
import { FileProblem, registerFileSource, sliceOf, type FileFormat } from "./files";

/*
 * Development only: a file source for trying the reader. It serves files put
 * in <state>/books/test-files, named by ISBN-13 (9780000000000.epub). Never
 * registered in production; real sources are the household's own.
 */
const dir = join(stateDir, "books", "test-files");
const formats: FileFormat[] = ["epub", "pdf"];

export function registerTestFiles() {
  if (process.env.NODE_ENV === "production" || !existsSync(dir)) return;
  registerFileSource({
    name: "test",
    async find(book) {
      return readdirSync(dir).flatMap((name) => {
        const [isbn, ext] = name.split(".");
        if (!book.isbns.includes(isbn) || !formats.includes(ext as FileFormat)) return [];
        return [{ id: name, format: ext as FileFormat, size: statSync(join(dir, name)).size, label: "Test file", language: null, sample: false }];
      });
    },
    async open(id, range) {
      if (!/^\d{13}\.(epub|pdf)$/.test(id) || !existsSync(join(dir, id))) throw new FileProblem("No such file.");
      return sliceOf(new Uint8Array(readFileSync(join(dir, id))), id, range);
    },
  });
}
