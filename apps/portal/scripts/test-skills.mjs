import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSkill, deleteSkill, migrateSkills, saveMadeSkill, setSkill, skillsForTurn, skillsOf, updateSkill } from "../src/lib/code/skills.ts";

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

test("anyone publishes their own; a published skill is in the Marketplace, off and readable until added", () => {
  const db = fresh();
  const id = createSkill(db, ana, draft);
  assert.throws(() => updateSkill(db, root, id, { published: true }), /isn't here/);
  updateSkill(db, ana, id, { published: true });
  const seen = skillsOf(db, "bo").find((s) => s.id === id);
  assert.equal(seen.enabled, false);
  assert.equal(seen.author, "Ana");
  assert.equal(seen.custom.published, true);
  assert.equal(seen.custom.mine, false);
  assert.equal(seen.custom.body, draft.body);
  assert.equal(seen.custom.uses, 0);
  assert.equal(skillsForTurn(db, "bo", true).skills.includes("meal-planner"), false);
  setSkill(db, "bo", id, true);
  assert.ok(skillsForTurn(db, "bo", true).skills.includes("meal-planner"));
  assert.equal(skillsOf(db, "cy").find((s) => s.id === id).custom.uses, 1);
  const always = createSkill(db, ana, { ...draft, name: "Teach", kind: "always", published: true });
  setSkill(db, "bo", always, true);
  assert.deepEqual(skillsForTurn(db, "bo", true).always, ["teach-2"]);
  assert.deepEqual(skillsForTurn(db, "bo", false).always, []);
  assert.throws(() => updateSkill(db, { username: "bo", admin: false }, id, { name: "Mine now" }), /isn't yours/);
  assert.throws(() => deleteSkill(db, { username: "bo", admin: false }, id), /isn't here/);
  /* An admin can take it down, but not publish someone's for them. */
  updateSkill(db, root, id, { published: false });
  assert.equal(skillsOf(db, "bo").some((s) => s.id === id), false);
  assert.throws(() => updateSkill(db, root, id, { published: true }), /isn't here/);
  deleteSkill(db, root, always);
  assert.equal(skillsOf(db, "bo").some((s) => s.id === always), false);
});

test("the Skill builder's skill is saved as the owner's, published, on, with the command they chose", () => {
  const db = fresh();
  const made = saveMadeSkill(db, ana, JSON.stringify({ name: "Week planner", description: "Plans my week.", kind: "on-demand", command: "plan-week", body: "Ask about the week.", publish: true }));
  assert.equal(made.problem, undefined);
  assert.equal(made.command, "plan-week");
  assert.equal(made.published, true);
  const mine = skillsOf(db, ana).find((s) => s.id === made.skill);
  assert.equal(mine.enabled, true);
  assert.equal(skillsOf(db, "bo").find((s) => s.id === made.skill).author, "Ana");
  const changed = saveMadeSkill(db, ana, JSON.stringify({ update: "plan-week", body: "Ask about the week, then plan it.", publish: false }));
  assert.equal(changed.updated, true);
  assert.equal(changed.published, false);
  assert.equal(skillsOf(db, "bo").some((s) => s.id === made.skill), false);
  assert.match(saveMadeSkill(db, ana, JSON.stringify({ update: "nope", body: "x" })).problem, /no skill of yours/);
  assert.equal(saveMadeSkill(db, ana, JSON.stringify({ name: "Teach", description: "x", body: "y", command: "teach" })).command, "teach-2");
});
