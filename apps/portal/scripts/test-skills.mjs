import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSkill, deleteSkill, migrateSkills, setSkill, skillsForTurn, skillsOf, updateSkill } from "../src/lib/code/skills.ts";

const fresh = () => { const db = new DatabaseSync(":memory:"); migrateSkills(db); return db; };
const ana = { username: "ana", admin: false, author: "Ana" };
const root = { username: "root", admin: true, author: "Root" };
const draft = { name: "Meal planner", description: "Plans the week's meals.", kind: "on-demand", body: "Ask what's in the fridge, then plan." };

test("a person's own skill is theirs alone, on, and reaches their turns by its slug", () => {
  const db = fresh();
  const id = createSkill(db, ana, draft);
  const mine = skillsOf(db, ana).find((s) => s.id === id);
  assert.equal(mine.enabled, true);
  assert.equal(mine.command.name, "meal-planner");
  assert.equal(mine.custom.body, draft.body);
  assert.equal(skillsOf(db, "bo").some((s) => s.id === id), false);
  const turn = skillsForTurn(db, "ana", true);
  assert.ok(turn.skills.includes("meal-planner"));
  assert.equal(turn.custom[0].id, "meal-planner");
  assert.match(turn.custom[0].file, /^---\nname: meal-planner\ndescription: "Plans the week's meals."\n---\n\nAsk what's/);
  setSkill(db, "ana", id, false);
  assert.equal(skillsForTurn(db, "ana", true).custom.length, 0);
});

test("only an admin publishes; a published skill is everyone's, off until turned on", () => {
  const db = fresh();
  assert.throws(() => createSkill(db, ana, { ...draft, published: true }), /Only an admin/);
  const id = createSkill(db, ana, draft);
  assert.throws(() => updateSkill(db, ana, id, { published: true }), /Only an admin/);
  assert.throws(() => updateSkill(db, root, id, { published: true }), /isn't here/);
  const theirs = createSkill(db, root, { ...draft, name: "Teach", kind: "always", published: true });
  const seen = skillsOf(db, "bo").find((s) => s.id === theirs);
  assert.equal(seen.enabled, false);
  assert.equal(seen.custom.body, undefined);
  assert.equal(seen.command, undefined);
  setSkill(db, "bo", theirs, true);
  assert.deepEqual(skillsForTurn(db, "bo", true).always, ["teach-2"]);
  assert.deepEqual(skillsForTurn(db, "bo", false).always, []);
  assert.throws(() => updateSkill(db, ana, theirs, { name: "Mine now" }), /isn't yours/);
  assert.throws(() => deleteSkill(db, ana, theirs), /isn't here/);
  deleteSkill(db, root, theirs);
  assert.equal(skillsOf(db, "bo").some((s) => s.id === theirs), false);
});
