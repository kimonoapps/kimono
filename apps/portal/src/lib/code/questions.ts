/*
 * Questions the agent puts to the person (infra/sandbox/bin/kimono-ask). It writes them to
 * /workspace/.kimono/questions/<id>.json and ends its turn; Kimono shows them in place of the
 * writing bar, and the answers go back as the person's next message.
 */

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header?: string; options: QuestionOption[]; multi: boolean };
export type QuestionAnswer = { picked: string[]; other?: string };

export const questionsDir = ".kimono/questions";
/** What kimono-ask prints: the id of the questions it wrote. */
export const askedId = (output: string) => /\(question (\d{10,16}-[0-9a-f]{8})\)/.exec(output)?.[1];
export const isAskCommand = (input: string | undefined) => {
  if (!input) return false;
  try { const command = (JSON.parse(input) as { command?: unknown }).command; return typeof command === "string" && /(^|[\s;&|(])kimono-ask(\s|$)/.test(command); } catch { return false; }
};

const words = (value: unknown, most: number) => typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, most) : undefined;

/** The questions as kimono-ask wrote them, checked again: one to four, each with two to four options. */
export function questionsOf(text: string): Question[] | undefined {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return undefined; }
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list) || list.length < 1 || list.length > 4) return undefined;
  const out: Question[] = [];
  for (const q of list as Record<string, unknown>[]) {
    const question = words(q?.question, 200);
    const options = Array.isArray(q?.options) ? (q.options as Record<string, unknown>[]).flatMap((o) => {
      const label = words(o?.label, 80);
      const description = words(o?.description, 160);
      return label ? [{ label, ...(description ? { description } : {}) }] : [];
    }) : [];
    if (!question || options.length < 2 || options.length > 4) return undefined;
    const header = words(q.header, 30);
    out.push({ question, ...(header ? { header } : {}), options, multi: q.multi === true });
  }
  return out;
}

/** The person's answers, checked against what was asked: picks must be its options, and each question gets something. */
export function answersOf(questions: Question[], raw: unknown): QuestionAnswer[] | undefined {
  if (!Array.isArray(raw) || raw.length !== questions.length) return undefined;
  const out: QuestionAnswer[] = [];
  for (const [i, q] of questions.entries()) {
    const a = raw[i] as { picked?: unknown; other?: unknown };
    const picked = Array.isArray(a?.picked) ? [...new Set(a.picked.filter((p): p is string => typeof p === "string"))] : [];
    if (picked.some((p) => !q.options.some((o) => o.label === p))) return undefined;
    if (!q.multi && picked.length > 1) return undefined;
    const other = words(a?.other, 2000);
    if (!picked.length && !other) return undefined;
    out.push({ picked, ...(other ? { other } : {}) });
  }
  return out;
}

/** The answers as the person's message: one question reads as just its answer, several as "name: answer" lines. */
export function answerText(questions: Question[], answers: QuestionAnswer[]): string {
  const said = answers.map((a) => [...a.picked, ...(a.other ? [a.other] : [])].join(", "));
  if (questions.length === 1) return said[0];
  return questions.map((q, i) => `${q.header ?? q.question}: ${said[i]}`).join("\n");
}

/** How the agent asks, and how it learns their taste: joins its instructions every turn. */
export const askNote = "To ask the person something, run kimono-ask with the questions as JSON on stdin (`kimono-ask --help` shows the shape): one to four questions, each with two to four short options, `multi: true` when several can apply; they can always write their own answer. Their writing bar turns into your questions, so ask only when their answer changes what you do and you can't tell from what they said or what you remember, then end your turn at once with nothing more. Their answers come as their next message.\n\nNow and then, not as a habit, ask how something landed: only the first time you make a kind of thing for them (their first video or animation, their first long artifact) or when you tried something clearly new with them, and only when nothing you remember already says how they like it. Then end that turn with one kimono-ask of questions that would change what you make next time (did it help, too long or too short, too simple or too much). Most turns ask nothing: never after an ordinary answer, never twice in a chat, and never again about a kind of thing once you remember their taste for it. When they answer, keep what it says about their taste with kimono-remember, changing the memory you already have on that (`--change`) rather than adding another, so what you remember grows into a picture of how they like things made; then go on as they said.";
