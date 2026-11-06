/*
 * Which Claude answers (docs/kimono-ai.md, "Choosing the model"). People can
 * pick one; by default Kimono picks per message: Opus when it builds something,
 * Haiku for a quick word, Sonnet for everything in between, which is most of
 * what a household asks (files, documents, email, plans).
 */

export const modelChoices = ["auto", "opus", "sonnet", "haiku"] as const;
export type ModelChoice = (typeof modelChoices)[number];
export type Model = Exclude<ModelChoice, "auto">;

const building = /\b(code|coding|program(ming)?|script|website|web ?site|web ?app|apps?|build|deploy|debug|bug|function|api|html|css|javascript|typescript|python|react|database|sql|compile|refactor|repo(sitory)?|git|server|frontend|backend|component)\b/i;
const work = /\b(sort|rename|move|convert|make|create|write|draft|send|email|mail|schedule|find|search|organi[sz]e|summari[sz]e|edit|fix|translate|plan|compare|analy[sz]e|calculate|resize|compress|merge|split|extract|scan|read|look|check|photos?|pictures?|files?|folders?|pdfs?|docs?|documents?|spreadsheets?|calendar|drive|notes?|list)\b/i;

/** The model for one message, when the person left it to Kimono. */
export function chooseModel(input: { prompt: string; attachments: number; building: boolean }): Model {
  const prompt = input.prompt.trim();
  if (input.building || building.test(prompt)) return "opus";
  if (input.attachments > 0 || work.test(prompt) || prompt.length > 280) return "sonnet";
  return prompt.length <= 160 ? "haiku" : "sonnet";
}

/** What the person chose, or Kimono's pick when they chose Auto (or nothing). */
export function modelFor(choice: unknown, input: { prompt: string; attachments: number; building: boolean }): Model {
  return choice === "opus" || choice === "sonnet" || choice === "haiku" ? choice : chooseModel(input);
}

export const modelNames: Record<Model, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
