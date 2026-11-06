/* What a file is, by its name and type: what a preview can show of it. */

/** Files the Drive server can make a picture of (lib/drive/thumbs.ts). */
export const pictureExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "tif", "tiff"]);

/** Files read as text: code, notes, data, config. */
export const textExtensions = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "toml", "xml", "ini", "conf", "cfg", "env", "sh", "zsh", "bash",
  "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "rs", "swift", "kt", "kts", "java", "c", "h", "cc", "cpp", "hpp", "cs", "css", "scss", "html", "htm",
  "sql", "rb", "php", "lua", "r", "tex", "srt", "vtt", "gradle", "properties", "dockerfile", "makefile"]);

/** "png", "md"; the whole name, lowered, when there's no dot (Dockerfile, Makefile). */
export const lowerExtension = (name: string) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
};

/** "PNG", "MD", "FILE": the short label a file wears when there's no mark for it. */
export const extensionLabel = (name: string) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
};

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "file";

export function previewKind(name: string, mime?: string | null): PreviewKind {
  const type = mime ?? "";
  const ext = lowerExtension(name);
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"].includes(ext)) return "image";
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "m4v", "mkv"].includes(ext)) return "video";
  if (type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"].includes(ext)) return "audio";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (textExtensions.has(ext) || type.startsWith("text/") || type === "application/json") return "text";
  return "file";
}

export const isMarkdown = (name: string) => ["md", "markdown", "mdx", "mark"].includes(lowerExtension(name));
