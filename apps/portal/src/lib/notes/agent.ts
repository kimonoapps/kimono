import { notebookPlace, type Notebook } from "./model";

/**
 * What Kimono AI is told about Kimono Notes, so it reads and writes the
 * household's notes the way the Notes app shows them. A notebook is a folder
 * in a Drive space, so it asks for one with kimono-access like any folder.
 */
export function notesGuide(notebooks: Pick<Notebook, "name" | "isSpace" | "space">[]): string {
  if (!notebooks.length) return "";
  const first = notebooks[0];
  const ask = first.isSpace ? `--space "${first.name}"` : `--space "${first.space.name}" --path "${first.name}"`;
  return [
    `Kimono Notes is where this household writes things down. Their notebooks: ${notebooks.slice(0, 40).map((n) => `"${notebookPlace(n)}"`).join(", ")} (space / notebook). A notebook is a folder in a Drive space: ask for it with kimono-access like any folder (kimono-access ask ${ask} --read or --change). In it every note is a Markdown file named by its title ("Groceries.md") and folders are sections. They read and edit notes in the Notes app, which styles the Markdown as they type.`,
    "- When they mention their notes, a list, a plan, a recipe, or anything they wrote down, look in their notebooks first: ask to read the notebook, then search its .md files.",
    "- When they ask you to note, jot or write something down, add to a list, or keep something for them or the household to read, write it in a note: ask to read and change the notebook, then add to the right note, or make a new one if none fits. kimono-remember is only for what you should know about them; notes are for them.",
    "- Write plain Markdown. The file name is the title, so don't start with a heading that repeats it. To-dos are \"- [ ] \", done ones \"- [x] \". When editing, keep their wording and order and change only what was asked. No HTML, front matter or pictures, and only .md files in a notebook.",
    "- Name a new note as a person would (\"Kyoto trip\", not \"kyoto_trip_notes\").",
    "- Afterwards say what changed in one sentence (\"Added oat milk to Groceries.\"). Call them notes and notebooks, never files, folders, spaces or Markdown.",
  ].join("\n");
}
