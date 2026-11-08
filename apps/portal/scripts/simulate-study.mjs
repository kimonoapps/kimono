#!/usr/bin/env node
/*
 * Study simulations for Kimono AI, against a local Portal.
 *
 * A simulated student (Claude, playing a persona) keeps a real study session
 * going with Kimono AI, message after message: stuck on a problem, getting
 * things wrong, saying how they want to be helped. A grader then reads the
 * whole session (what was said, every visual it made, what it remembered) and
 * scores how well it taught: guiding rather than handing over answers,
 * following what the student asked for, keeping track of the problem, and
 * drawing the thing on its own when a picture would help, not only when asked.
 * Some scenarios open a second chat later, to see whether a preference stuck.
 *
 *   node scripts/simulate-study.mjs [--only em-waves,stats] [--runs 1] [--out <dir>]
 *
 * Needs the local Portal on :3000 with Kimono AI set up (its state in
 * /tmp/kimono-portal-test), the sandbox node running, and the `claude` CLI.
 * It signs in as kimono-test with the local AUTH_SECRET, and the student and
 * grader use the same model token local Kimono AI uses. Never point it at a
 * real deployment.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encode } from "next-auth/jwt";
import { scenarios } from "./study-scenarios.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : pairs, []));
const portal = args.portal ?? "http://localhost:3000";
const state = args.state ?? "/tmp/kimono-portal-test";
const out = resolve(args.out ?? join(state, "simulations", new Date().toISOString().replace(/[:.]/g, "-")));
const runs = Number(args.runs ?? 1);
const concurrency = Number(args.concurrency ?? 2);
const studentModel = args.student ?? "sonnet";
const graderModel = args.grader ?? "opus";
const picked = args.only ? scenarios.filter((s) => args.only.split(",").includes(s.id)) : scenarios;
if (!picked.length) throw new Error(`No scenario called ${args.only}. There are: ${scenarios.map((s) => s.id).join(", ")}`);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portal)) throw new Error("Simulations only run against a local Portal.");

/* ── signing in, and the model token for the student and grader ── */

const envFile = readFileSync(new URL("../.env", import.meta.url), "utf8");
const secret = /^AUTH_SECRET=(.*)$/m.exec(envFile)?.[1]?.replace(/^["']|["']$/g, "").trim();
if (!secret) throw new Error("No AUTH_SECRET in apps/portal/.env.");
const cookie = `authjs.session-token=${await encode({ secret, salt: "authjs.session-token", token: { username: "kimono-test", name: "Kimono Test", role: "owner", sessionId: randomUUID(), signedInAt: Date.now(), identityId: "simulation" } })}`;
const settings = JSON.parse(readFileSync(join(state, "settings.json"), "utf8"));
const modelToken = settings.apps?.["kimono-code"]?.environment?.model_token?.value?.trim();
if (!modelToken) throw new Error("Local Kimono AI has no model token.");

async function api(path, init = {}) {
  const response = await fetch(`${portal}/api/v1/code${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...init.headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* ── Claude, for the student and the grader ── */

function claude(model, system, prompt, { timeout = 300_000 } = {}) {
  return new Promise((done, fail) => {
    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: modelToken };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn("claude", ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--system-prompt", system], { cwd: out, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error(`claude timed out after ${timeout / 1000}s`)); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? done(stdout.trim()) : fail(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 300)}`)); });
    child.stdin.end(prompt);
  });
}

/* ── one chat with Kimono AI ── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sends one message (starting the chat with the first) and waits for its turn to end. Returns the turn's events. */
async function send(chat, text) {
  let after;
  if (!chat.id) {
    const made = await api("/workspaces", { method: "POST", body: JSON.stringify({ prompt: text }) });
    chat.id = made.id;
    after = 0;
  } else {
    after = (await api(`/workspaces/${chat.id}/turns`, { method: "POST", body: JSON.stringify({ text, attachments: [] }) })).seq;
  }
  const started = Date.now();
  for (;;) {
    const { events } = await api(`/workspaces/${chat.id}/events?after=${after}`);
    const done = events.find((e) => e.event.kind === "done");
    if (done) {
      const turn = events.filter((e) => e.seq <= done.seq);
      return { events: turn, seconds: Math.round((Date.now() - started) / 1000) };
    }
    if (Date.now() - started > 15 * 60_000) return { events, seconds: Math.round((Date.now() - started) / 1000), timedOut: true };
    await sleep(2500);
  }
}

async function artifactSource(chatId, name) {
  try {
    const found = await api(`/workspaces/${chatId}/artifacts/${encodeURIComponent(name)}`);
    return { title: found.title ?? name, content: String(found.content ?? "") };
  } catch { return { title: name, content: "" }; }
}

/** The turn as the student sees it: what it said, and a line for each visual it showed. */
function forStudent(turn) {
  const parts = [];
  for (const { event } of turn.events) {
    if (event.kind === "text" && event.text.trim()) parts.push(event.text.trim());
    if (event.kind === "artifact" && event.action !== "edited") parts.push(`[Kimono showed you something you can look at: "${event.name}"]`);
    if (event.kind === "done" && !event.ok) parts.push(`[Kimono failed: ${event.error ?? "no answer"}]`);
  }
  return parts.join("\n\n") || "[Kimono said nothing]";
}

/** The turn as the grader reads it: everything it did, in order. */
function forGrader(turn) {
  const parts = [];
  for (const { event } of turn.events) {
    if (event.kind === "text" && event.text.trim()) parts.push(event.text.trim());
    else if (event.kind === "tool") parts.push(`[tool: ${event.label}${event.detail ? ` — ${String(event.detail).slice(0, 200)}` : ""}]`);
    else if (event.kind === "artifact") parts.push(`[visual ${event.action}: ${event.name}]`);
    else if (event.kind === "remembered") parts.push(`[memory ${event.how ?? "kept"}: ${event.text}]`);
    else if (event.kind === "sent") parts.push(`[sent files: ${event.files.map((f) => f.name).join(", ")}]`);
    else if (event.kind === "done") parts.push(`[turn ${event.ok ? "done" : `failed: ${event.error}`}${event.model ? `, ${event.model}` : ""}${turn.seconds ? `, ${turn.seconds}s` : ""}]`);
  }
  return parts.join("\n");
}

/* ── the student ── */

const studentSystem = (scenario, session) => `You are role-playing a student using Kimono AI, an AI assistant, to study. Stay in character the whole time. You are testing whether it actually helps you learn.

Who you are: ${scenario.persona}

What you're working on: ${session.situation}

How this session should go (follow it loosely, reacting to what Kimono actually says; never mention this plan):
${session.beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}

Rules:
- Write only your next message to Kimono, nothing else: no quotes, no labels, no stage directions.
- Write like this student really texts: ${scenario.voice}
- React to what Kimono just said. If it asks you a question, try to answer it the way this student would (sometimes wrong, sometimes "idk"). If it showed you something to look at, you can react to it.
- Don't be a perfect student and don't help Kimono teach. Don't ask for a diagram or visual unless the plan says to.
- If Kimono forgets what you were doing, gets something wrong, or ignores what you asked for, react like a real student would (confused, annoyed).
- When the session is naturally over (you got it, you're done, or you give up), or after about ${session.turns} messages, reply with exactly <<END>>.`;

async function studentSays(scenario, session, history) {
  const transcript = history.map((h) => `${h.who === "student" ? "YOU" : "KIMONO"}: ${h.text}`).join("\n\n");
  const prompt = history.length
    ? `The conversation so far:\n\n${transcript}\n\nWrite your next message (you've sent ${history.filter((h) => h.who === "student").length} so far).`
    : "Write your first message to Kimono.";
  const said = (await claude(studentModel, studentSystem(scenario, session), prompt, { timeout: 180_000 })).trim();
  return said.replace(/^(YOU|Student|Me):\s*/i, "");
}

/* ── the grader ── */

const graderSystem = `You grade an AI tutor (Kimono AI) from a transcript of a real study session with a simulated student. Be strict and specific, like an experienced teacher reviewing a tutoring session. Quote the transcript to back up each point. Answer with JSON only, no prose around it.`;

function graderPrompt(scenario, sessions) {
  const body = sessions.map((s, n) => {
    const visuals = s.visuals.map((v) => `--- visual "${v.name}" (${v.title}), made in turn ${v.turn}, source (truncated):\n${v.content.slice(0, 5000)}`).join("\n\n");
    return `=== Chat ${n + 1}${n ? " (a NEW chat, started later; the student did not repeat earlier preferences)" : ""}: ${s.situation}\n\n${s.log}\n\n${visuals ? `Visuals it made in this chat:\n\n${visuals}` : "It made no visuals in this chat."}`;
  }).join("\n\n\n");
  return `Scenario: ${scenario.title}
Student: ${scenario.persona}
What a great tutor would do here: ${scenario.expect.join(" ")}

Memories Kimono kept about the student during the run: ${JSON.stringify(sessions.flatMap((s) => s.remembered))}

${body}

Grade with this JSON shape (scores 1-5, 5 = what an excellent human tutor would do):
{
  "scores": {
    "teaching": <guides the student to understand: asks, checks understanding, builds on what they say, doesn't just lecture or dump steps>,
    "preferences": <notices how the student wants to be helped (said outright or implied) and keeps doing it, including in the new chat if there is one>,
    "continuity": <keeps track of the problem and where they are; never loses the thread>,
    "visuals": <draws the thing (diagram, graph, interactive) on its own when a picture would help an explanation or a problem, at the right moment, not only when asked; visuals are correct and actually help; no pointless visuals>,
    "correctness": <physics/maths/facts right; catches the student's mistakes>,
    "fit": <length, tone and pace suit this student>
  },
  "remembered_preference": <true if it kept the student's stated way of learning as a memory for future chats, else false>,
  "used_memory_in_new_chat": <true/false, or null if there was no second chat>,
  "gave_answers_against_wishes": <true if, after the student asked not to be given answers, it still handed over final answers>,
  "missed_visuals": [{"turn": "<chat.turn, e.g. 1.3>", "what": "<the visual that would have helped there>"}],
  "good_moments": ["<short, quoted>"],
  "failures": [{"turn": "<chat.turn>", "what": "<what went wrong, quoted>", "fix": "<what Kimono should do instead>"}],
  "summary": "<two sentences>"
}`;
}

function parseJson(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

/* ── one scenario ── */

async function runScenario(scenario, run) {
  const dir = join(out, `${scenario.id}${runs > 1 ? `-run${run}` : ""}`);
  mkdirSync(dir, { recursive: true });
  const before = new Set((await api("/memory")).memories.map((m) => m.id));
  const sessions = [];
  for (const [n, session] of scenario.sessions.entries()) {
    const chat = { id: null };
    const history = [];
    const log = [];
    const visuals = [];
    for (let turn = 1; turn <= session.turns + 2; turn++) {
      const said = await studentSays(scenario, session, history);
      if (said.includes("<<END>>")) break;
      history.push({ who: "student", text: said });
      log.push(`[${n + 1}.${turn}] STUDENT: ${said}`);
      process.stdout.write(`  ${scenario.id} ${n + 1}.${turn} student: ${said.slice(0, 80).replace(/\n/g, " ")}\n`);
      const reply = await send(chat, said);
      history.push({ who: "kimono", text: forStudent(reply) });
      log.push(`[${n + 1}.${turn}] KIMONO:\n${forGrader(reply)}`);
      for (const { event } of reply.events) {
        if (event.kind === "artifact" && event.action === "wrote") visuals.push({ name: event.name, turn: `${n + 1}.${turn}`, ...(await artifactSource(chat.id, event.name)) });
      }
      writeFileSync(join(dir, `chat-${n + 1}.md`), `# ${scenario.title}, chat ${n + 1}\n\n${session.situation}\n\nChat ${chat.id}\n\n${log.join("\n\n")}\n`);
      if (reply.timedOut) { log.push("[the turn never finished]"); break; }
    }
    const remembered = (await api("/memory")).memories.filter((m) => !before.has(m.id)).map((m) => m.text);
    sessions.push({ situation: session.situation, chat: chat.id, log: log.join("\n\n"), visuals, remembered, turns: history.filter((h) => h.who === "student").length });
  }
  let grade;
  try { grade = parseJson(await claude(graderModel, graderSystem, graderPrompt(scenario, sessions), { timeout: 600_000 })); }
  catch (error) { grade = { error: String(error) }; }
  const result = { scenario: scenario.id, title: scenario.title, run, chats: sessions.map((s) => ({ id: s.chat, turns: s.turns, visuals: s.visuals.map((v) => `${v.turn} ${v.name}`) })), remembered: [...new Set(sessions.flatMap((s) => s.remembered))], grade };
  writeFileSync(join(dir, "grade.json"), JSON.stringify(result, null, 2));
  /* What this student taught it goes, so the next scenario starts as this one did. Run one at a time for that to hold. */
  if (args["keep-memories"] !== "true") {
    for (const m of (await api("/memory")).memories) if (!before.has(m.id)) await api(`/memory/${m.id}`, { method: "DELETE" }).catch(() => {});
  }
  return result;
}

/* ── all of them, two chats at a time (a person's awake sandboxes are capped) ── */

mkdirSync(out, { recursive: true });
console.log(`Simulating ${picked.length} scenario(s) × ${runs} → ${out}`);
const jobs = picked.flatMap((s) => Array.from({ length: runs }, (_, i) => () => runScenario(s, i + 1).catch((error) => ({ scenario: s.id, title: s.title, run: i + 1, grade: { error: String(error) } }))));
const results = [];
await Promise.all(Array.from({ length: concurrency }, async () => { for (let job; (job = jobs.shift());) results.push(await job()); }));

const dims = ["teaching", "preferences", "continuity", "visuals", "correctness", "fit"];
const row = (r) => `| ${r.title}${runs > 1 ? ` #${r.run}` : ""} | ${dims.map((d) => r.grade.scores?.[d] ?? "–").join(" | ")} | ${r.grade.remembered_preference ? "yes" : "no"} | ${r.grade.used_memory_in_new_chat ?? "–"} | ${r.chats?.reduce((n, c) => n + c.visuals.length, 0) ?? 0} | ${r.grade.missed_visuals?.length ?? "–"} |`;
const report = `# Study simulations\n\n${new Date().toISOString()}\n\n| Scenario | ${dims.join(" | ")} | remembered | used in new chat | visuals made | visuals missed |\n|${"---|".repeat(dims.length + 5)}\n${results.map(row).join("\n")}\n\n${results.map((r) => `## ${r.title}${runs > 1 ? ` #${r.run}` : ""}\n\n${r.grade.error ? `Failed: ${r.grade.error}` : `${r.grade.summary}\n\n**Remembered:** ${r.remembered?.join("; ") || "nothing"}\n\n**Failures**\n${(r.grade.failures ?? []).map((f) => `- ${f.turn}: ${f.what} → ${f.fix}`).join("\n") || "- none"}\n\n**Missed visuals**\n${(r.grade.missed_visuals ?? []).map((m) => `- ${m.turn}: ${m.what}`).join("\n") || "- none"}\n\n**Good**\n${(r.grade.good_moments ?? []).map((g) => `- ${g}`).join("\n") || "- none"}`}`).join("\n\n")}\n`;
writeFileSync(join(out, "report.md"), report);
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\nReport: ${join(out, "report.md")}`);
