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
 * What to play: the person's choice for this show if they made one in the
 * player, else their settings. Anime defaults to the original with subtitles;
 * a dub gets signs-only subtitles so on-screen text is still translated.
 */
export function trackPlan(title: { shelf: string; originalLanguage: string }, prefs: Prefs, choice?: TrackChoice | null): TrackPlan {
  const mine = prefs.audioLanguage || "en";
  const subsLang = prefs.subtitleLanguage || mine;
  const original = title.originalLanguage || (title.shelf === "Anime" ? "ja" : mine);
  const audio = choice?.audio
    || (title.shelf === "Anime" ? (prefs.animeAudio === "dub" ? mine : original) : (prefs.filmAudio === "mine" ? mine : original));
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

/** For ranking releases: the audio wanted and the title's original, plus the subtitle language when the audio isn't the person's. */
export const wantFor = (plan: TrackPlan, original: string) => ({ audio: plan.audio, original, subtitles: plan.subtitles?.kind === "full" ? plan.subtitles.language : null });
export type LanguageWant = ReturnType<typeof wantFor>;
