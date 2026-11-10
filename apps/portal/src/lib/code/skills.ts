import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CodeProblem } from "./model";

/*
 * Skills: well-known published skills a person can turn on for Kimono AI. The
 * skills themselves are in the sandbox image (infra/sandbox/skills, copied
 * with their licences by infra/sandbox/vendor-skills.sh); this is the
 * catalog's face, and who turned what on.
 *
 *   always     shapes every reply (I have ADHD). Its words join the system
 *              prompt each turn, for the chat's owner only.
 *   on demand  something it can do when it fits (Word documents, a Socratic
 *              tutor). Linked into ~/.claude/skills; the agent loads it when
 *              its description matches what's asked.
 *
 * A person's choice is kept per skill; one they never touched follows the
 * catalog's default.
 *
 * Anyone can also write skills of their own (custom_skills): a name, when it
 * should be used, and its instructions. They're theirs alone until an admin
 * publishes one, which puts it in everyone's catalog, off until they turn it
 * on. A turn hands the sandbox each custom skill that's on as a SKILL.md to
 * write beside the image's own.
 */

export type SkillKind = "always" | "on-demand";
export type Skill = { id: string; name: string; description: string; kind: SkillKind; defaultOn: boolean; icon: string; source: string; author: string; license: string; /** Its slash command in the chat box, and what to type after it. */ command?: { name: string; hint?: string; does: string }; /** A skill someone here wrote: whether it's this person's, whether it's published, and (when they may change it) its instructions. */ custom?: { mine: boolean; published: boolean; editable: boolean; body?: string } };
export type SkillChoice = Skill & { enabled: boolean };

export const skills: Skill[] = [
  { id: "i-have-adhd", name: "I have ADHD", description: "Leads with the next step, numbers the steps and keeps track of where you are.", kind: "always", defaultOn: false, icon: "spark", source: "https://github.com/ayghri/i-have-adhd", author: "Ayoub Ghriss", license: "MIT" },
  { id: "teach", name: "Teach me", description: "Type /teach and a topic: lessons over as many chats as it takes, with cheat sheets and a record of what you've learned.", kind: "on-demand", defaultOn: true, icon: "spark", source: "https://github.com/mattpocock/skills/tree/main/skills/productivity/teach", author: "Matt Pocock", license: "MIT", command: { name: "teach", hint: "what to learn", does: "Lessons on a topic, over as many chats as it takes" } },
  { id: "wait-what", name: "Wait, what?", description: "Type /wait-what when it lost you, and it explains its last reply again in plain words.", kind: "on-demand", defaultOn: true, icon: "chat", source: "https://github.com/mattpocock/skills/tree/main/skills/productivity/wait-what", author: "Matt Pocock", license: "MIT", command: { name: "wait-what", does: "Explain the last reply again, in plain words" } },
  { id: "feynman", name: "Feynman technique", description: "Explains a concept simply, finds the gaps, fills them, then tightens it up.", kind: "on-demand", defaultOn: true, icon: "spark", source: "https://github.com/neurofoo/agent-skills/tree/main/feynman", author: "neurofoo", license: "MIT", command: { name: "feynman", hint: "a concept", does: "Understand something by explaining it simply" } },
  { id: "grilling", name: "Grill me", description: "Asks you hard questions about a plan or idea until nothing is left assumed.", kind: "on-demand", defaultOn: true, icon: "chat", source: "https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling", author: "Matt Pocock", license: "MIT", command: { name: "grilling", hint: "a plan or idea", does: "Hard questions until nothing is left assumed" } },
  { id: "socratic-method", name: "Socratic tutor", description: "Guides you to the answer with questions instead of telling you.", kind: "on-demand", defaultOn: false, icon: "chat", source: "https://github.com/malkreide/socratic-method-skill", author: "malkreide", license: "MIT" },
  { id: "humanizer", name: "Humanizer", description: "Rewrites text so it reads like you, not like AI.", kind: "on-demand", defaultOn: true, icon: "file", source: "https://github.com/blader/humanizer", author: "blader", license: "MIT" },
  { id: "docx", name: "Word documents", description: "Makes and edits proper .docx files, with headings, tables and tracked changes.", kind: "on-demand", defaultOn: true, icon: "file", source: "https://github.com/anthropics/skills/tree/main/skills/docx", author: "Anthropic", license: "Apache-2.0" },
  { id: "pdf", name: "PDFs", description: "Reads, fills, merges and makes PDFs.", kind: "on-demand", defaultOn: true, icon: "file", source: "https://github.com/anthropics/skills/tree/main/skills/pdf", author: "Anthropic", license: "Apache-2.0" },
  { id: "pptx", name: "PowerPoint", description: "Makes and edits slide decks.", kind: "on-demand", defaultOn: true, icon: "file", source: "https://github.com/anthropics/skills/tree/main/skills/pptx", author: "Anthropic", license: "Apache-2.0" },
  { id: "xlsx", name: "Excel spreadsheets", description: "Makes spreadsheets with working formulas and charts.", kind: "on-demand", defaultOn: true, icon: "file", source: "https://github.com/anthropics/skills/tree/main/skills/xlsx", author: "Anthropic", license: "Apache-2.0" },
  { id: "frontend-design", name: "Website design", description: "Gives websites it builds a distinctive look instead of a template one.", kind: "on-demand", defaultOn: true, icon: "code", source: "https://github.com/anthropics/skills/tree/main/skills/frontend-design", author: "Anthropic", license: "Apache-2.0" },
  { id: "discernment-nudge", name: "Think it through", description: "After advice or a draft, prompts you to check it for yourself.", kind: "on-demand", defaultOn: false, icon: "spark", source: "https://github.com/anthropics/skills/tree/main/skills/discernment-nudge", author: "Anthropic", license: "Apache-2.0" },
];

const known = new Set(skills.map((s) => s.id));
const reserved = new Set(skills.flatMap((s) => [s.id, ...(s.command ? [s.command.name] : [])]));

export function migrateSkills(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS skill_choices (username TEXT NOT NULL, skill_id TEXT NOT NULL, enabled INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (username, skill_id))");
  db.exec("CREATE TABLE IF NOT EXISTS custom_skills (id TEXT PRIMARY KEY, owner TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS custom_skills_owner ON custom_skills (owner)");
  db.exec("CREATE TABLE IF NOT EXISTS notices_seen (username TEXT NOT NULL, notice TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (username, notice))");
}

/* Notices a person has to acknowledge once (the one before Kimono AI's first answer on Islam), and who has. */
export const notices = new Set(["islam"]);

/** Joins a turn's context until the person has accepted the notice: on Islam, the reply waits for it. */
export const islamNoticeNote = "This person hasn't yet accepted Kimono's notice about asking AI about Islam. If their message is about Islam (its rulings, worship, beliefs, the Quran, hadith or its history), reply with only the islam-notice block, nothing before or after it, and end your turn: Kimono shows them the notice, and once they accept it their question comes back to you to answer. Otherwise answer as usual.";
export function noticeSeen(db: DatabaseSync, username: string, notice: string): boolean {
  return !!db.prepare("SELECT 1 FROM notices_seen WHERE username = ? AND notice = ?").get(username, notice);
}
export function seeNotice(db: DatabaseSync, username: string, notice: string, now = Date.now()) {
  db.prepare("INSERT OR IGNORE INTO notices_seen (username, notice, at) VALUES (?, ?, ?)").run(username, notice, now);
}

type CustomRow = { id: string; owner: string; author: string; name: string; slug: string; description: string; kind: SkillKind; body: string; published: number };
export type SkillViewer = { username: string; admin: boolean };

/** Custom skills this person can see: their own, and every published one. */
function customRows(db: DatabaseSync, username: string): CustomRow[] {
  return db.prepare("SELECT id, owner, author, name, slug, description, kind, body, published FROM custom_skills WHERE owner = ? OR published = 1 ORDER BY published DESC, created_at").all(username) as CustomRow[];
}

function asSkill(row: CustomRow, viewer: SkillViewer): Skill {
  const mine = row.owner === viewer.username;
  const editable = mine || (viewer.admin && row.published === 1);
  return {
    id: row.id, name: row.name, description: row.description, kind: row.kind, defaultOn: mine, icon: row.kind === "always" ? "spark" : "chat",
    source: "", author: row.author, license: "",
    ...(row.kind === "on-demand" ? { command: { name: row.slug, does: row.description } } : {}),
    custom: { mine, published: row.published === 1, editable, ...(editable ? { body: row.body } : {}) },
  };
}

/** The catalog as this person has it: each skill, and whether it's on for them. */
export function skillsOf(db: DatabaseSync, viewer: string | SkillViewer): SkillChoice[] {
  const who = typeof viewer === "string" ? { username: viewer, admin: false } : viewer;
  const rows = db.prepare("SELECT skill_id, enabled FROM skill_choices WHERE username = ?").all(who.username) as { skill_id: string; enabled: number }[];
  const chosen = new Map(rows.map((r) => [r.skill_id, r.enabled === 1]));
  const all = [...skills, ...customRows(db, who.username).map((row) => asSkill(row, who))];
  return all.map((skill) => ({ ...skill, enabled: chosen.get(skill.id) ?? skill.defaultOn }));
}

export function setSkill(db: DatabaseSync, username: string, id: string, enabled: boolean, now = Date.now()) {
  if (!known.has(id) && !customRows(db, username).some((row) => row.id === id)) throw new Error("no such skill");
  db.prepare("INSERT INTO skill_choices (username, skill_id, enabled, at) VALUES (?, ?, ?, ?) ON CONFLICT (username, skill_id) DO UPDATE SET enabled = excluded.enabled, at = excluded.at")
    .run(username, id, enabled ? 1 : 0, now);
}

/* ── skills people write ── */

export const customLimits = { name: 60, description: 300, body: 20_000, perPerson: 40 };
export type CustomSkillInput = { name?: unknown; description?: unknown; kind?: unknown; body?: unknown; published?: unknown };

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new CodeProblem(`Give it ${what}.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new CodeProblem(`Its ${what === "a name" ? "name" : what === "a description" ? "description" : "instructions"} can be at most ${max.toLocaleString("en")} characters.`);
  return trimmed;
}

function slugFor(db: DatabaseSync, name: string, except?: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "skill";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (reserved.has(slug)) continue;
    const taken = db.prepare("SELECT id FROM custom_skills WHERE slug = ?").get(slug) as { id: string } | undefined;
    if (!taken || taken.id === except) return slug;
  }
}

function row(db: DatabaseSync, id: string): CustomRow | undefined {
  return db.prepare("SELECT id, owner, author, name, slug, description, kind, body, published FROM custom_skills WHERE id = ?").get(id) as CustomRow | undefined;
}

/** Writes a new skill of this person's own. Only an admin can publish it at once. */
export function createSkill(db: DatabaseSync, viewer: SkillViewer & { author: string }, input: CustomSkillInput, now = Date.now()): string {
  const name = text(input.name, "a name", customLimits.name);
  const description = text(input.description, "a description", customLimits.description);
  const body = text(input.body, "instructions", customLimits.body);
  const kind: SkillKind = input.kind === "always" ? "always" : "on-demand";
  if (input.published === true && !viewer.admin) throw new CodeProblem("Only an admin can publish a skill.", 403);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM custom_skills WHERE owner = ?").get(viewer.username) as { n: number }).n;
  if (count >= customLimits.perPerson) throw new CodeProblem(`You can keep up to ${customLimits.perPerson} skills of your own.`);
  const id = `c-${randomBytes(6).toString("hex")}`;
  db.prepare("INSERT INTO custom_skills (id, owner, author, name, slug, description, kind, body, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, viewer.username, viewer.author, name, slugFor(db, name), description, kind, body, input.published === true ? 1 : 0, now, now);
  return id;
}

/** Changes a skill: its owner, or an admin for a published one. Publishing either way is for admins. */
export function updateSkill(db: DatabaseSync, viewer: SkillViewer, id: string, input: CustomSkillInput, now = Date.now()) {
  const current = row(db, id);
  if (!current || (current.owner !== viewer.username && current.published !== 1)) throw new CodeProblem("That skill isn't here.", 404);
  if (current.owner !== viewer.username && !viewer.admin) throw new CodeProblem("That skill isn't yours to change.", 403);
  if (input.published !== undefined && typeof input.published !== "boolean") throw new CodeProblem("Say whether it's published.");
  if (input.published !== undefined && input.published !== (current.published === 1) && !viewer.admin) throw new CodeProblem("Only an admin can publish a skill.", 403);
  const name = input.name === undefined ? current.name : text(input.name, "a name", customLimits.name);
  const description = input.description === undefined ? current.description : text(input.description, "a description", customLimits.description);
  const body = input.body === undefined ? current.body : text(input.body, "instructions", customLimits.body);
  const kind: SkillKind = input.kind === undefined ? current.kind : input.kind === "always" ? "always" : "on-demand";
  const published = input.published === undefined ? current.published : input.published ? 1 : 0;
  const slug = name === current.name ? current.slug : slugFor(db, name, id);
  db.prepare("UPDATE custom_skills SET name = ?, slug = ?, description = ?, kind = ?, body = ?, published = ?, updated_at = ? WHERE id = ?")
    .run(name, slug, description, kind, body, published, now, id);
}

/** Deletes a skill: its owner, or an admin for a published one. Everyone's choice about it goes too. */
export function deleteSkill(db: DatabaseSync, viewer: SkillViewer, id: string) {
  const current = row(db, id);
  if (!current || (current.owner !== viewer.username && !(viewer.admin && current.published === 1))) throw new CodeProblem("That skill isn't here.", 404);
  db.prepare("DELETE FROM custom_skills WHERE id = ?").run(id);
  db.prepare("DELETE FROM skill_choices WHERE skill_id = ?").run(id);
}

/** A custom skill as the sandbox writes it: ~/.kimono/custom-skills/<slug>/SKILL.md. */
function skillFile(row: CustomRow): string {
  return `---\nname: ${row.slug}\ndescription: ${JSON.stringify(row.description.replace(/\s+/g, " "))}\n---\n\n${row.body}\n`;
}

/** What a turn hands the sandbox: the on-demand skills to link in, the always ones (only for the chat's owner's own turns), and the words of the custom ones among them. */
export function skillsForTurn(db: DatabaseSync, owner: string, byOwner: boolean): { skills: string[]; always: string[]; custom: { id: string; file: string }[] } {
  /* A custom skill's folder is its slug, so its / command is the name the agent knows it by. */
  const rows = new Map(customRows(db, owner).map((r) => [r.id, r]));
  const folder = (id: string) => rows.get(id)?.slug ?? id;
  const on = skillsOf(db, owner).filter((s) => s.enabled);
  const linked = on.filter((s) => s.kind === "on-demand").map((s) => s.id);
  const always = byOwner ? on.filter((s) => s.kind === "always").map((s) => s.id) : [];
  const wanted = new Set([...linked, ...always]);
  const custom = [...rows.values()].filter((r) => wanted.has(r.id)).map((r) => ({ id: r.slug, file: skillFile(r) }));
  return { skills: linked.map(folder), always: always.map(folder), custom };
}
