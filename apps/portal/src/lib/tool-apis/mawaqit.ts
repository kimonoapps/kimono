/** Adapted from mawaqit-gnome calendar.js and extension.js, commit 0e0a730. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const names = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
type Calendar = { timezone: string; calendar: Array<Record<string, string[]>> };

export function mosqueSlug(value: string) {
  const text = value.trim();
  const match = /^https:\/\/mawaqit\.net\/(?:[a-z]{2}\/)?(?:m\/)?([a-zA-Z0-9_-]+)\/?$/.exec(text);
  const slug = match ? match[1] : text;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(slug)) throw new ApiError(400, "invalid_mosque", "Enter a mosque slug or its Mawaqit URL.");
  return slug;
}

/** Extract JSON without executing upstream JavaScript. */
export function parseCalendar(html: string): Calendar {
  const assignment = /(?:var|let|const)\s+confData\s*=\s*/.exec(html);
  if (!assignment) throw new ApiError(502, "invalid_upstream", "Mawaqit did not return a prayer calendar.");
  const start = assignment.index + assignment[0].length;
  if (html[start] !== "{") throw new ApiError(502, "invalid_upstream", "Unsupported calendar format.");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      let data: Calendar;
      try { data = JSON.parse(html.slice(start, i + 1)); }
      catch { throw new ApiError(502, "invalid_upstream", "Invalid prayer calendar JSON."); }
      if (!data || typeof data.timezone !== "string" || !Array.isArray(data.calendar) || data.calendar.length !== 12 || data.calendar.some((month) => !month || typeof month !== "object" || Array.isArray(month))) throw new ApiError(502, "invalid_upstream", "Unsupported prayer calendar.");
      try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format(); }
      catch { throw new ApiError(502, "invalid_upstream", "Invalid mosque timezone."); }
      return { timezone: data.timezone, calendar: data.calendar };
    }
  }
  throw new ApiError(502, "invalid_upstream", "Incomplete prayer calendar.");
}

export function searchParameters(query: URLSearchParams) {
  const q = query.get("q")?.trim();
  const lat = query.get("lat"), lon = query.get("lon");
  if (q && (lat !== null || lon !== null)) throw new ApiError(400, "invalid_query", "Use q or lat and lon, not both.");
  if (q) {
    if (q.length < 2 || q.length > 120) throw new ApiError(400, "invalid_query", "q must contain 2 to 120 characters.");
    return new URLSearchParams({ word: q });
  }
  if (!lat?.trim() || !lon?.trim() || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) throw new ApiError(400, "invalid_query", "Supply q or valid lat and lon coordinates.");
  return new URLSearchParams({ lat: String(Number(lat)), lon: String(Number(lon)) });
}

export function dailyTimes(data: Calendar, requested?: string | null, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: data.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = requested ?? `${parts.year}-${parts.month}-${parts.day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new ApiError(400, "invalid_date", "date must be a valid YYYY-MM-DD date.");
  if (date.slice(0, 4) !== parts.year) throw new ApiError(400, "unsupported_year", "Only the current mosque calendar year is supported.");
  const times = data.calendar[Number(date.slice(5, 7)) - 1]?.[String(Number(date.slice(8, 10)))];
  if (!Array.isArray(times) || times.length < 6 || times.slice(0, 6).some((time) => typeof time !== "string" || !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(time))) throw new ApiError(502, "invalid_upstream", "No valid prayer times for this date.");
  return { date, timezone: data.timezone, times: names.map((name, index) => ({ name, time: times[index] })) };
}

async function upstream(url: string) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Kimono-Tools/0.1", Accept: "application/json, text/html" }, redirect: "error", signal: AbortSignal.timeout(10000), next: { revalidate: 300 } });
    if (!response.ok) throw new ApiError(response.status === 404 ? 404 : 502, "upstream_error", response.status === 404 ? "Mosque not found." : "Mawaqit is temporarily unavailable.");
    if (!response.body) throw new ApiError(502, "invalid_upstream", "Empty upstream response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); let length = 0, text = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError(502, "invalid_upstream", "Upstream response is too large."); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "upstream_unavailable", "Could not reach Mawaqit. Try again later.");
  }
}

export async function executeMawaqit(operation: string, query: URLSearchParams) {
  if (operation === "search") {
    const text = await upstream(`https://mawaqit.net/api/2.0/mosque/search?${searchParameters(query)}`);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new ApiError(502, "invalid_upstream", "Invalid mosque search response."); }
    if (!Array.isArray(data)) throw new ApiError(502, "invalid_upstream", "Invalid mosque search response.");
    return { mosques: data.filter((mosque) => mosque && typeof mosque.slug === "string" && typeof mosque.name === "string" && !mosque.closed).slice(0, 50).map((mosque) => ({ slug: mosque.slug, name: mosque.name, location: typeof mosque.localisation === "string" ? mosque.localisation : null })) };
  }
  const mosque = mosqueSlug(query.get("mosque") || "");
  const data = parseCalendar(await upstream(`https://mawaqit.net/en/${encodeURIComponent(mosque)}`));
  if (operation === "calendar") return { mosque, ...data, fetchedAt: new Date().toISOString() };
  if (operation === "prayer-times") return { mosque, ...dailyTimes(data, query.get("date")), fetchedAt: new Date().toISOString() };
  throw new ApiError(404, "unknown_endpoint", "Endpoint not found.");
}
