/*
 * The sandbox's own commands (infra/sandbox/bin/kimono-*) said in words: a shell line that is only
 * these, with the usual trimmings (| head, echo ---, 2>&1), reads "Read the Quran 6:59 · 6:76–79"
 * rather than the line itself. Anything else in the line and it stays a command.
 */

export type Said = { label: string; detail?: string; doing: string };

const tafsirs: Record<string, string> = { "ibn-kathir": "Ibn Kathir", saadi: "al-Sa'di", muyassar: "al-Muyassar", tabari: "al-Tabari", qurtubi: "al-Qurtubi" };
const books: Record<string, string> = { bukhari: "Bukhari", muslim: "Muslim", abudawud: "Abu Dawud", tirmidhi: "Tirmidhi", nasai: "Nasa'i", ibnmajah: "Ibn Majah", malik: "Muwatta Malik", nawawi: "Nawawi's Forty", qudsi: "Hadith Qudsi" };

/** A shell line's words, quotes taken off; null where it does something a reader would need to see (subshells, heredocs). */
function words(text: string): string[] | null {
  if (/\$\(|`|<</.test(text)) return null;
  const out: string[] = [];
  let word = "", inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end < 0) return null;
      word += text.slice(i + 1, end).replace(c === '"' ? /\\(["\\$`])/g : /$^/, "$1");
      i = end; inWord = true;
    } else if (/\s/.test(c)) { if (inWord) out.push(word); word = ""; inWord = false; }
    else { word += c; inWord = true; }
  }
  if (inWord) out.push(word);
  return out;
}

/** Steps that only trim or space what a command printed. */
const trimming = /^(head|tail|sed|cut|wc|cat|sort|uniq|less|more|jq|grep|true|sleep)$/;
const isTrim = (w: string[]) => !w.length || trimming.test(w[0]) || (w[0] === "echo" && w.slice(1).every((x) => /^[-=_.*#\s]*$/.test(x)));
const ref = (value: string) => value.replace(/(\d)-(\d)/g, "$1–$2");
const base = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
const flag = (w: string[], name: string) => { const at = w.indexOf(name); return at >= 0 ? w[at + 1] : undefined; };
const plain = (w: string[]) => w.filter((x, i) => !x.startsWith("-") && !(i > 0 && w[i - 1].startsWith("--") && !["--full", "--mobile", "--read", "--change", "--voices"].includes(w[i - 1])));
const clip = (value: string, max = 80) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

function one(name: string, w: string[]): Said | undefined {
  const args = plain(w);
  switch (name) {
    case "quran": {
      const tafsir = flag(w, "--tafsir");
      const what = args.map(ref).join(" ");
      return tafsir
        ? { label: `Read ${tafsirs[tafsir] ?? tafsir}'s tafsir on`, detail: what || undefined, doing: "Reading a tafsir" }
        : { label: "Read the Quran", detail: what || undefined, doing: "Reading the Quran" };
    }
    case "hadith": return { label: "Read a hadith", detail: args.length ? [books[args[0].toLowerCase()] ?? args[0], ...args.slice(1)].join(" ") : undefined, doing: "Reading a hadith" };
    case "chats": {
      const [how, ...rest] = args;
      if (how === "search") return { label: "Searched past chats for", detail: rest.join(" ") || undefined, doing: "Looking through past chats" };
      if (how === "read") return { label: "Read a past chat", doing: "Reading a past chat" };
      return { label: "Looked through past chats", doing: "Looking through past chats" };
    }
    case "remember":
      if (w.includes("--forget")) return { label: "Forgot something", doing: "Forgetting something" };
      if (w.includes("--change")) return { label: "Changed a memory", detail: args.slice(1).join(" ") || undefined, doing: "Remembering" };
      return { label: "Remembered", detail: args.join(" ") || undefined, doing: "Remembering" };
    case "fetch": return { label: "Fetched", detail: args[0], doing: "Fetching a link" };
    case "link": return { label: "Made a link to", detail: args[0] && base(args[0]), doing: "Making a link" };
    case "send": return { label: "Sent you", detail: args.map(base).join(", ") || undefined, doing: "Sending you files" };
    case "shot": return { label: "Took a screenshot of", detail: args[0], doing: "Taking a screenshot" };
    case "serve": return { label: "Started an app", detail: flag(w, "--kind"), doing: "Starting an app" };
    case "unserve": return { label: "Stopped the app", doing: "Stopping the app" };
    case "say": return w.includes("--voices") ? { label: "Listed voices", doing: "Listing voices" } : { label: "Spoke", detail: args[0] ? clip(args[0]) : undefined, doing: "Speaking" };
    case "access": return { label: "Asked for access to", detail: flag(w, "--space"), doing: "Asking for access" };
    default: return undefined;
  }
}

/** A line of nothing but kimono-* commands, in words; undefined for anything else. */
export function kimonoCommand(command: unknown): Said | undefined {
  if (typeof command !== "string" || !command.includes("kimono-")) return undefined;
  /* Its questions come as JSON on stdin (a heredoc), and show in place of the writing bar: the step just says so. */
  if (/^\s*(?:\S*\/)?kimono-ask(\s|$)/.test(command)) return { label: "Asked you", doing: "Asking you" };
  if (/^\s*(?:\S*\/)?kimono-skill(\s|$)/.test(command)) return { label: "Saved a skill", doing: "Saving the skill" };
  const said: Said[] = [];
  /* Each step of the line; within a step, what comes after a pipe only trims it. */
  for (const step of command.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, " ").split(/&&|\|\||;|\n/)) {
    const [head, ...piped] = step.split("|");
    const w = words(head.trim());
    if (!w) return undefined;
    if (piped.some((p) => { const pw = words(p.trim()); return !pw || !isTrim(pw); })) return undefined;
    if (isTrim(w)) continue;
    const name = /^(?:\S*\/)?kimono-([a-z]+)$/.exec(w[0])?.[1];
    const it = name ? one(name, w.slice(1)) : undefined;
    if (!it) return undefined;
    said.push(it);
  }
  if (!said.length) return undefined;
  /* The same kind of step again adds to its detail ("6:59 · 6:76–79"); another kind joins after. */
  const kinds: Said[] = [];
  for (const it of said) {
    const same = kinds.find((k) => k.label === it.label);
    if (same) { if (it.detail && !same.detail?.split(" · ").includes(it.detail)) same.detail = same.detail ? `${same.detail} · ${it.detail}` : it.detail; }
    else kinds.push({ ...it });
  }
  const [first, ...rest] = kinds;
  if (!rest.length) return first;
  const detail = [first.detail, ...rest.map((k) => [k.label[0].toLowerCase() + k.label.slice(1), k.detail].filter(Boolean).join(" "))].filter(Boolean).join(" · ");
  return { label: first.label, detail, doing: first.doing };
}
