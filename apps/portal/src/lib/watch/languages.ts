/**
 * Sub, dub and languages: which audio and subtitles someone should get for a
 * title, and how players find those tracks inside a file.
 *
 * Most anime and many films carry several audio and subtitle tracks in one
 * file ("dual audio": the Japanese original and an English dub, with full
 * subtitles and signs-only ones). So picking a language is mostly picking
 * tracks; the release only matters when the file lacks the language wanted
 * (./releases.ts ranks by it).
 *
 * Pure, tested in scripts/test-watch.mjs.
 */
import type { Prefs, TrackChoice } from "./model";

/** Language names as release listings write them, to ISO 639-1. */
const byName: Record<string, string> = {
  english: "en", japanese: "ja", french: "fr", german: "de", spanish: "es", latino: "es", castilian: "es", italian: "it",
  portuguese: "pt", brazilian: "pt", russian: "ru", arabic: "ar", hindi: "hi", chinese: "zh", mandarin: "zh", cantonese: "zh",
  korean: "ko", polish: "pl", indonesian: "id", thai: "th", vietnamese: "vi", turkish: "tr", dutch: "nl", malay: "ms",
  tamil: "ta", telugu: "te", hebrew: "he", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi", czech: "cs",
  hungarian: "hu", greek: "el", romanian: "ro", ukrainian: "uk", persian: "fa", filipino: "tl", bengali: "bn",
};
export const languageOf = (name: string): string | null => byName[name.trim().toLowerCase()] ?? (/^[a-z]{2}$/.test(name.trim()) ? name.trim() : null);

/** The codes a container tags tracks with: "ja" is "jpn", "fr" is "fre" or "fra". Players match any of these. */
const tags: Record<string, string[]> = {
  en: ["eng"], ja: ["jpn"], fr: ["fre", "fra"], de: ["ger", "deu"], es: ["spa"], it: ["ita"], pt: ["por"], ru: ["rus"],
  ar: ["ara"], hi: ["hin"], zh: ["chi", "zho"], ko: ["kor"], pl: ["pol"], id: ["ind"], th: ["tha"], vi: ["vie"], tr: ["tur"],
  nl: ["dut", "nld"], ms: ["may", "msa"], he: ["heb"], sv: ["swe"], no: ["nor"], da: ["dan"], fi: ["fin"], cs: ["cze", "ces"],
  hu: ["hun"], el: ["gre", "ell"], ro: ["rum", "ron"], uk: ["ukr"], fa: ["per", "fas"], ta: ["tam"], te: ["tel"], bn: ["ben"],
};
export const trackTags = (lang: string) => [lang, ...(tags[lang] ?? [])];

export type TrackPlan = {
  /** The audio language to play. */
  audio: string;
  /** Subtitles: a language with full dialogue or signs only, or none. */
  subtitles: { language: string; kind: "full" | "signs" } | null;
};

/**
 * What to play: the person's choice for this show if they made one, else
 * their preferred language (each title's original by default). Listening in
 * your own language gets signs-only subtitles, so on-screen text is still
 * translated.
 */
export function trackPlan(title: { shelf: string; originalLanguage: string }, prefs: Prefs, choice?: TrackChoice | null): TrackPlan {
  const original = originalOf(title, prefs);
  const audio = choice?.audio || (prefs.preferredLanguage && prefs.preferredLanguage !== "original" ? prefs.preferredLanguage : original);
  return planFor(audio, prefs, choice);
}

/** A title's original language: anime is Japanese when nothing says. */
export const originalOf = (title: { shelf: string; originalLanguage: string }, prefs: Prefs) => title.originalLanguage || (title.shelf === "Anime" ? "ja" : prefs.audioLanguage || "en");

/** The fallback as a language: "original" is the title's own. */
export const fallbackOf = (fallback: string, original: string) => (fallback === "original" ? original : fallback);

/**
 * The copy picked has no track in the language planned but has the fallback
 * (known from its listing): play the fallback, with subtitles worked out again.
 */
export function withFallback(plan: TrackPlan, prefs: Prefs, languages: string[], choice?: TrackChoice | null, original = ""): TrackPlan {
  const fallback = fallbackOf(prefs.fallbackLanguage || "en", original);
  if (!fallback) return plan;
  if (!languages.length || languages.includes(plan.audio) || languages.includes("multi") || plan.audio === fallback || !languages.includes(fallback)) return plan;
  return planFor(fallback, prefs, choice ? { ...choice, subtitles: choice.subtitles === plan.audio ? "off" : choice.subtitles } : null);
}

function planFor(audio: string, prefs: Prefs, choice?: TrackChoice | null): TrackPlan {
  const subsLang = prefs.subtitleLanguage || prefs.audioLanguage || "en";
  if (choice) {
    if (choice.subtitles === "off") return { audio, subtitles: null };
    if (choice.subtitles === "signs") return { audio, subtitles: { language: subsLang, kind: "signs" } };
    return { audio, subtitles: { language: choice.subtitles, kind: "full" } };
  }
  if (prefs.subtitles === "off") return { audio, subtitles: null };
  if (prefs.subtitles === "always" || audio !== subsLang) return { audio, subtitles: { language: subsLang, kind: "full" } };
  /* Listening in your own language: only the signs and songs, when the file has them. */
  return { audio, subtitles: { language: subsLang, kind: "signs" } };
}

/**
 * What players are told: the tags to look for, in order. A subtitle track
 * titled like "Signs", "Songs" or "Forced" is signs-only; anything else with
 * the language is full dialogue.
 */
export function playerTracks(plan: TrackPlan) {
  return {
    audio: { language: plan.audio, tags: trackTags(plan.audio) },
    subtitles: plan.subtitles
      ? { language: plan.subtitles.language, tags: trackTags(plan.subtitles.language), kind: plan.subtitles.kind, signsTitles: ["signs", "songs", "forced", "s&s"] }
      : null,
  };
}

/** For ranking releases: the audio wanted, the fallback and the title's original, plus the subtitle language when the audio isn't the person's. */
export const wantFor = (plan: TrackPlan, original: string, fallback = "") => ({ audio: plan.audio, original, fallback: fallbackOf(fallback, original), subtitles: plan.subtitles?.kind === "full" ? plan.subtitles.language : null });
export type LanguageWant = ReturnType<typeof wantFor>;
