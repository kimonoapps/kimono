/**
 * What Kimono AI is told about Kimono Notes, so it reads and writes the
 * household's notes the way the Notes app shows them. A notebook is a Drive
 * space, so it asks for one with kimono-access like any other space.
 */
export function notesGuide(notebooks: { name: string; own: boolean }[]): string {
  if (!notebooks.length) return "";
  const own = notebooks.find((n) => n.own)?.name;
  const shared = notebooks.filter((n) => !n.own).map((n) => `"${n.name}"`);
  const which = [own ? `their own is "${own}"` : "", shared.length ? `shared with them: ${shared.join(", ")}` : ""].filter(Boolean).join("; ");
  return [
    `Kimono Notes is where this household writes things down. Each notebook is a space you can ask for with kimono-access (${which}). In a notebook every note is a Markdown file named by its title ("Groceries.md") and folders are sections. They read and edit notes in the Notes app, which styles the Markdown as they type.`,
    "- When they mention their notes, a list, a plan, a recipe, or anything they wrote down, look in their notebooks first: ask to read the notebook, then search its .md files.",
    "- When they ask you to note, jot or write something down, add to a list, or keep something for them or the household to read, write it in a note: ask to read and change the notebook, then add to the right note, or make a new one if none fits. kimono-remember is only for what you should know about them; notes are for them.",
    "- Write plain Markdown. The file name is the title, so don't start with a heading that repeats it. To-dos are \"- [ ] \", done ones \"- [x] \". When editing, keep their wording and order and change only what was asked. No HTML, front matter or pictures, and only .md files in a notebook.",
    "- Name a new note as a person would (\"Kyoto trip\", not \"kyoto_trip_notes\").",
    "- Afterwards say what changed in one sentence (\"Added oat milk to Groceries.\"). Call them notes and notebooks, never files, spaces or Markdown.",
  ].join("\n");
}
