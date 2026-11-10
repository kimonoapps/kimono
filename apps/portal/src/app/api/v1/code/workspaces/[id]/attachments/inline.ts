/* Shown as themselves: pictures, video and sound so they play, and PDFs in the browser's viewer (the sandbox below still lets it). Anything else downloads, so a page or an SVG never runs as Kimono. */
export const inline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac", "application/pdf"]);
