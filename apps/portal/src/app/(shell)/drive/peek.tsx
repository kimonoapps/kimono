"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Scroller } from "@/components/scroller";
import { fileIcons } from "./file-icons";

/*
 * Code in the drawer: numbered lines and a light, hand-sized highlighter
 * (comments, strings, numbers, keywords) that fits every language well enough
 * for a glance. Not a parser; the file opens properly in an editor.
 */

type Language = { name: string; line?: readonly string[]; block?: readonly [string, string]; keywords?: string };
const languages: Record<string, Language> = {};
const c = { line: ["//"], block: ["/*", "*/"] } as const;
const hash = { line: ["#"] } as const;
const js = "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this super null undefined true false void yield static get set interface type enum implements as readonly public private protected declare keyof";
for (const [exts, info] of [
  [["js", "mjs", "cjs", "jsx"], { name: "JavaScript", ...c, keywords: js }],
  [["ts", "tsx"], { name: "TypeScript", ...c, keywords: js }],
  [["go"], { name: "Go", ...c, keywords: "package import func return if else for range switch case default break continue go defer chan select struct interface map type var const nil true false" }],
  [["rs"], { name: "Rust", ...c, keywords: "fn let mut pub use mod struct enum impl trait for in if else match loop while return self Self crate super as where async await move ref dyn const static true false None Some Ok Err" }],
  [["swift"], { name: "Swift", ...c, keywords: "func let var return if else guard for in while switch case default break continue struct class enum protocol extension import self Self init nil true false async await throws try catch public private internal static override some any" }],
  [["kt", "kts", "gradle"], { name: "Kotlin", ...c, keywords: "fun val var return if else when for in while class object interface data sealed enum import package this super null true false suspend override private public internal companion is as" }],
  [["java"], { name: "Java", ...c, keywords: "public private protected class interface enum extends implements import package return if else for while switch case break continue new static final void this super null true false try catch finally throw throws" }],
  [["c", "h"], { name: "C", ...c, keywords: "int char long short float double void unsigned signed struct union enum typedef static const return if else for while do switch case break continue sizeof NULL include define" }],
  [["cc", "cpp", "hpp"], { name: "C++", ...c, keywords: "int char long float double void bool auto struct class namespace using template typename public private protected virtual override const static return if else for while switch case break continue new delete nullptr true false include define" }],
  [["cs"], { name: "C#", ...c, keywords: "public private protected internal class interface struct enum namespace using return if else for foreach in while switch case break continue new static void var this base null true false async await" }],
  [["css", "scss"], { name: "CSS", ...c, keywords: "" }],
  [["py"], { name: "Python", ...hash, keywords: "def class return if elif else for in while import from as with try except finally raise pass break continue lambda yield async await None True False and or not is self" }],
  [["rb"], { name: "Ruby", ...hash, keywords: "def class module end return if elsif else unless for in while do require self nil true false yield" }],
  [["sh", "bash", "zsh", "env"], { name: "Shell", ...hash, keywords: "if then else elif fi for in do done while case esac function return export local echo" }],
  [["yaml", "yml"], { name: "YAML", ...hash, keywords: "true false null" }],
  [["toml", "ini", "conf", "cfg", "properties"], { name: "Config", line: ["#", ";"], keywords: "true false" }],
  [["sql"], { name: "SQL", line: ["--"], block: ["/*", "*/"], keywords: "select from where insert into values update set delete create table index primary key foreign references join left right inner outer on group by order having limit as and or not null default unique" }],
  [["lua"], { name: "Lua", line: ["--"], keywords: "local function return if then else elseif end for in while do nil true false and or not" }],
  [["php"], { name: "PHP", ...c, keywords: "function return if else foreach as for while class public private protected new echo null true false" }],
  [["json"], { name: "JSON", keywords: "true false null" }],
  [["html", "htm", "xml"], { name: "HTML", block: ["<!--", "-->"] }],
  [["r"], { name: "R", ...hash, keywords: "function return if else for in while TRUE FALSE NULL" }],
] as [readonly string[], Language][]) for (const ext of exts) languages[ext] = info;

/** A file type's mark (TypeScript, Android, Excel…), or [fallback] when there's none or it won't load. */
export function TypeMark({ name, fallback }: { name: string; fallback: ReactNode }) {
  const dot = name.lastIndexOf(".");
  const icon = fileIcons[(dot > 0 ? name.slice(dot + 1) : name).toLowerCase()];
  const [failed, setFailed] = useState(false);
  if (!icon || failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- a small static SVG
  return <img className="dv-type" src={`/file-icons/${icon}.svg`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export const codeLanguage = (ext: string) => languages[ext.toLowerCase()]?.name ?? null;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits [text] into marked runs for [ext]'s language. */
function highlight(text: string, ext: string): ReactNode[] {
  const lang = languages[ext.toLowerCase()];
  if (!lang) return [text];
  const parts = [
    lang.block ? `${escape(lang.block[0])}[\\s\\S]*?(?:${escape(lang.block[1])}|$)` : null,
    lang.line?.length ? `(?:${lang.line.map(escape).join("|")})[^\\n]*` : null,
    `"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?`,
    `\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b`,
    lang.keywords ? `\\b(?:${lang.keywords.split(" ").join("|")})\\b` : null,
  ];
  const kinds = ["com", "com", "str", "num", "key"];
  const pattern = new RegExp(parts.map((part) => `(${part ?? "(?!)"})`).join("|"), "gi");
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const group = match.slice(1).findIndex(Boolean);
    out.push(<span key={at} className={`t-${kinds[group]}`}>{match[0]}</span>);
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A code file's opening, numbered and coloured. */
export function CodePeek({ text, ext, inline = false }: { text: string; ext: string; inline?: boolean }) {
  const marked = highlight(text, ext);
  /* Lines are counted on the plain text; the marked runs flow inside one block beside them. */
  const lines = text.split("\n").length;
  return <>
    <span className="dv-code-lang"><TypeMark name={`x.${ext}`} fallback={null} />{codeLanguage(ext)}</span>
    <Scroller className={inline ? undefined : "dv-fill"} viewClassName="dv-code" tone="lift" fit={inline} tabIndex={0}>
      <ol aria-hidden="true">{Array.from({ length: lines }, (_, index) => <li key={index}>{index + 1}</li>)}</ol>
      <pre><code>{marked.map((run, index) => <Fragment key={index}>{run}</Fragment>)}</code></pre>
    </Scroller>
  </>;
}
