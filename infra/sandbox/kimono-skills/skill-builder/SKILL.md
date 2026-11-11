---
name: skill-builder
description: >
  Makes a new Kimono AI skill with the person and publishes it to Kimono's
  Marketplace. Use when they type /skill-builder, or ask to make, write or
  build a skill, a command or a custom behaviour for Kimono AI ("make me a
  /recipe command", "I want a skill that plans my week"), or to change one
  they made.
---

# Skill builder

A skill is a short set of instructions Kimono AI follows: either in every
reply, or when what someone asks matches what it's for, or when they type its
/ command. You make one with the person, then save it with `kimono-skill`,
which publishes it to the Marketplace for everyone here to add.

## 1. Ask, with kimono-ask

Start from what they already said, and ask only what you can't guess well.
Ask in one round with `kimono-ask` (up to four questions, two to four options
each; they can always write their own). Usually:

- **When it's used** (header "When"): "When I type its command", "Whenever
  it fits what I ask", "In every reply". Put the one that fits best first.
- **Its command** (header "Command"): two or three short names you suggest,
  lowercase with dashes (`/meal-plan`, `/plan-week`), best first.
- One or two questions about what it should actually do that change the
  instructions most: its output (a table, a checklist, a short message), its
  length or tone, what it should ask them for first, what to avoid. Make the
  options concrete and specific to this skill, never generic.

Then end your turn; their answers come as their next message. If they
already told you everything, skip straight to writing it. If an answer opens
a real gap, ask one more short round, never more than two rounds in all.

## 2. Write it

- **Name**: two to four plain words ("Meal planner").
- **What it's for** (the description): one sentence saying what it does and
  when to use it, in the person's words. Kimono AI picks it up from this, so
  name the requests it should match.
- **Instructions**: written to Kimono AI, as steps or short rules, the way
  you'd brief a capable friend: what to ask for if it's missing, what to make,
  in what shape, and what to leave out. Put in the details they gave you
  (their budget, their style, the format they chose). Keep it under a page;
  no headings unless it's long, no talk about Kimono or how skills work.

## 3. Save and publish it

```
kimono-skill <<'JSON'
{"name": "Meal planner", "description": "Plans a week of dinners from what's in the fridge, with a shopping list.",
 "kind": "on-demand", "command": "meal-plan",
 "body": "When they ask for a meal plan…"}
JSON
```

- `kind` is `"on-demand"` (by its command, or when it fits) or `"always"`
  (in every reply; it has no command).
- It's published to the Marketplace and switched on for them. Add
  `"publish": false` only if they said to keep it to themselves.
- To change one they made earlier, add `"update": "<its command>"` with the
  fields that change.

Then tell them in one or two lines: its name, its / command, and that it's in
the Marketplace for others. Don't paste the instructions back unless they ask.
