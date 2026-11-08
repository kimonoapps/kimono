import type { DatabaseSync } from "node:sqlite";

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
 */

export type SkillKind = "always" | "on-demand";
export type Skill = { id: string; name: string; description: string; kind: SkillKind; defaultOn: boolean; icon: string; source: string; author: string; license: string; /** Its slash command in the chat box, and what to type after it. */ command?: { name: string; hint?: string; does: string } };
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

export function migrateSkills(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS skill_choices (username TEXT NOT NULL, skill_id TEXT NOT NULL, enabled INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (username, skill_id))");
}

/** The catalog as this person has it: each skill, and whether it's on for them. */
export function skillsOf(db: DatabaseSync, username: string): SkillChoice[] {
  const rows = db.prepare("SELECT skill_id, enabled FROM skill_choices WHERE username = ?").all(username) as { skill_id: string; enabled: number }[];
  const chosen = new Map(rows.map((r) => [r.skill_id, r.enabled === 1]));
  return skills.map((skill) => ({ ...skill, enabled: chosen.get(skill.id) ?? skill.defaultOn }));
}

export function setSkill(db: DatabaseSync, username: string, id: string, enabled: boolean, now = Date.now()) {
  if (!known.has(id)) throw new Error("no such skill");
  db.prepare("INSERT INTO skill_choices (username, skill_id, enabled, at) VALUES (?, ?, ?, ?) ON CONFLICT (username, skill_id) DO UPDATE SET enabled = excluded.enabled, at = excluded.at")
    .run(username, id, enabled ? 1 : 0, now);
}

/** What a turn hands the sandbox: the on-demand skills to link in, and the always ones (only for the chat's owner's own turns). */
export function skillsForTurn(db: DatabaseSync, owner: string, byOwner: boolean): { skills: string[]; always: string[] } {
  const on = skillsOf(db, owner).filter((s) => s.enabled);
  return { skills: on.filter((s) => s.kind === "on-demand").map((s) => s.id), always: byOwner ? on.filter((s) => s.kind === "always").map((s) => s.id) : [] };
}
