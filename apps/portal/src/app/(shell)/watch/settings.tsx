"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { deviceOf, languageName, qualities, saveQuality, savedQuality, watchApi, type Prefs } from "./api";
import { Crossing } from "@/components/crossing";
import { cx, Img, useWatch } from "./bits";
import { Icon } from "./icons";
import { PROFILE_PICKER, type Person } from "./watch-app";

/*
 * Watch's settings (design/mockups/watch/review/spec.md §2): one page, every
 * change saved at once and ticked beside its control. Downloads belong to the
 * phone app, so they don't appear here. 4K shows greyed out, with why, where
 * this screen or browser can't play it.
 */

const languages = ["en", "ja", "fr", "de", "es", "it", "pt", "nl", "sv", "no", "da", "fi", "pl", "ru", "uk", "tr", "ar", "hi", "ko", "zh"];

export function SettingsPage({ me, onSwitch, signOut }: { me: Person; onSwitch: () => void; signOut: () => Promise<void> }) {
  const watch = useWatch();
  const prefs = watch.prefs;
  const [quality, setQuality] = useState(savedQuality);
  /* Why 4K can't play here, or null when it can (undefined while asking the browser). */
  const [no4k, setNo4k] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    deviceOf().then((d) => setNo4k(d.maxHeight < 2160 ? "This screen isn't 4K" : !d.codecs.some((c) => c === "hevc" || c === "av1") ? "This browser can't play 4K" : null), () => setNo4k("This browser can't play 4K"));
  }, []);
  const [ticked, setTicked] = useState<string | null>(null);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    watchApi.deviceQuality().then((q) => { const v = q ?? "auto"; setQuality(v); saveQuality(v); }, () => {});
  }, []);
  const tick = (key: string) => { setTicked(key); clearTimeout(tickTimer.current); tickTimer.current = setTimeout(() => setTicked(null), 1200); };
  const save = (key: string, change: Partial<Prefs>) => { void watch.updatePrefs(change).then((ok) => { if (ok) tick(key); }); };
  const pickQuality = (value: string) => {
    const before = quality;
    setQuality(value); saveQuality(value);
    watchApi.setDeviceQuality(value).then(() => tick("quality"), () => { setQuality(before); saveQuality(before); watch.toast("That didn't work."); });
  };
  const still = watch.known().find((c) => c.backdrop)?.backdrop ?? null;
  const mine = prefs?.audioLanguage || "en";

  return <main className="kw-page kw-settings">
    <h1>Settings</h1>
    {!prefs ? <div className="kw-set-wait">{Array.from({ length: 6 }, (_, i) => <div key={i} className="kw-sk kw-sk-line" style={{ height: 44 }} />)}</div> : <>
      <Section title="Playback">
        <Row label="Quality on this device" note={no4k ? `No 4K: ${no4k.charAt(0).toLowerCase()}${no4k.slice(1)}` : undefined} done={ticked === "quality"}>
          <Seg value={quality} onChange={pickQuality} options={qualities.map((q) => [q.value, q.label])} disabled={no4k !== null ? { "2160": no4k ?? "" } : undefined} />
        </Row>
        <Row label="Autoplay next episode" done={ticked === "autoplayNext"} inline><Toggle checked={prefs.autoplayNext} onChange={(on) => save("autoplayNext", { autoplayNext: on })} /></Row>
        <Row label="Skip intros and recaps" done={ticked === "skipIntros"} inline><Toggle checked={prefs.skipIntros} onChange={(on) => save("skipIntros", { skipIntros: on })} /></Row>
        <Row label="Autoplay previews" done={ticked === "previews"} inline><Toggle checked={prefs.previews !== false} onChange={(on) => save("previews", { previews: on })} /></Row>
      </Section>

      <Section title="Languages">
        <Row label="My language" done={ticked === "audioLanguage"}>
          <Pick value={mine} onChange={(v) => save("audioLanguage", { audioLanguage: v })} options={languages.map((l) => [l, languageName(l)])} label="My language" />
        </Row>
        <Row label="Anime" done={ticked === "animeAudio"}>
          <Seg value={prefs.animeAudio} onChange={(v) => save("animeAudio", { animeAudio: v as Prefs["animeAudio"] })} options={[["original", "Original with subtitles"], ["dub", "Dubbed"]]} />
        </Row>
        <Row label="Films and series" done={ticked === "filmAudio"}>
          <Seg value={prefs.filmAudio} onChange={(v) => save("filmAudio", { filmAudio: v as Prefs["filmAudio"] })} options={[["original", "Original audio"], ["mine", languageName(mine)]]} />
        </Row>
        <Row label="Subtitles" done={ticked === "subtitles"} note={prefs.subtitles === "auto" ? "When the audio isn’t in your language." : undefined}>
          <Seg value={prefs.subtitles} onChange={(v) => save("subtitles", { subtitles: v as Prefs["subtitles"] })} options={[["auto", "Automatic"], ["always", "Always"], ["off", "Off"]]} />
        </Row>
        <Row label="Subtitle language" done={ticked === "subtitleLanguage"}>
          <Pick value={prefs.subtitleLanguage} onChange={(v) => save("subtitleLanguage", { subtitleLanguage: v })} options={[["", "Same as my language"], ...languages.filter((l) => l !== mine).map((l) => [l, languageName(l)] as [string, string])]} label="Subtitle language" />
        </Row>
      </Section>

      <Section title="Subtitle look">
        <div className="kw-sub-preview">
          <Img src={still} eager />
          <div className={cx("kw-subs", "kw-subs-static", subtitleClass(prefs))}><span>I’ll walk with you as far as the mountains.</span></div>
        </div>
        <Row label="Size" done={ticked === "subtitleSize"}>
          <Seg value={prefs.subtitleSize ?? "medium"} onChange={(v) => save("subtitleSize", { subtitleSize: v as Prefs["subtitleSize"] })} options={[["small", "Small"], ["medium", "Medium"], ["large", "Large"]]} />
        </Row>
        <Row label="Background" done={ticked === "subtitleBackground"}>
          <Seg value={prefs.subtitleBackground ?? "shadow"} onChange={(v) => save("subtitleBackground", { subtitleBackground: v as Prefs["subtitleBackground"] })} options={[["none", "None"], ["shadow", "Shadow"], ["box", "Box"]]} />
        </Row>
      </Section>

      <Section title="Anime">
        <Row label="Episodes" done={ticked === "animeEpisodes"}>
          <Seg value={prefs.animeEpisodes ?? "seasons"} onChange={(v) => save("animeEpisodes", { animeEpisodes: v as Prefs["animeEpisodes"] })} options={[["seasons", "By season"], ["continuous", "One list"]]} />
        </Row>
        <Row label="Filler episodes" done={ticked === "fillers"}>
          <Seg value={prefs.fillers} onChange={(v) => save("fillers", { fillers: v as Prefs["fillers"] })} options={[["ask", "Ask"], ["skip", "Skip"], ["watch", "Watch"]]} />
        </Row>
      </Section>

      <Section title="Account">
        <div className="kw-set-me">
          <span className="kw-avatar kw-avatar-lg" aria-hidden="true">{me.picture
            // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
            ? <img src={me.picture} alt="" /> : (me.name.trim() || me.username).charAt(0).toUpperCase()}</span>
          <div><b>{me.name}</b><span>{me.username}</span></div>
        </div>
        <div className="kw-set-actions">
          {PROFILE_PICKER ? <button className="kw-btn kw-tonal" onClick={onSwitch}>Switch profile</button> : null}
          <Crossing kind="shoji" className="kw-btn kw-tonal" href="/account">Kimono account</Crossing>
          <form action={signOut}><button className="kw-btn kw-tonal" type="submit">Sign out</button></form>
        </div>
        <p className="kw-about">Kimono Watch · {typeof window !== "undefined" ? window.location.host : ""}</p>
      </Section>
    </>}
  </main>;
}

/** Classes for the subtitle look, shared with the player. */
export const subtitleClass = (prefs: Pick<Prefs, "subtitleSize" | "subtitleBackground"> | null | undefined) =>
  `kw-subs-${prefs?.subtitleSize ?? "medium"} kw-subs-${prefs?.subtitleBackground ?? "shadow"}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="kw-set"><h2>{title}</h2>{children}</section>;
}

function Row({ label, note, done, inline, children }: { label: string; note?: string; done?: boolean; inline?: boolean; children: ReactNode }) {
  return <div className={cx("kw-set-row", inline && "kw-inline")}>
    <div className="kw-set-label"><span>{label}</span>{note ? <small>{note}</small> : null}</div>
    <div className="kw-set-control">{children}<span className={cx("kw-tick", done && "kw-on")} aria-hidden="true"><Icon name="check" /></span></div>
  </div>;
}

/** A segmented joint: a few choices side by side. [disabled]: ones that can't be picked here, with why (on hover). */
function Seg({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (value: string) => void; disabled?: Record<string, string> }) {
  return <div className="kw-joint" role="radiogroup">
    {options.map(([v, label]) => <button key={v} role="radio" aria-checked={value === v} disabled={v in (disabled ?? {})} title={disabled?.[v] || undefined} className={cx(value === v && "kw-sel")} onClick={() => { if (value !== v) onChange(v); }}>{label}</button>)}
  </div>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return <label className="kw-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function Pick({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (value: string) => void; label: string }) {
  return <select className="kw-season kw-pick" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>;
}
