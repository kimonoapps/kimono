/*
 * Which Claude answers (docs/kimono-ai.md, "Choosing the model"). People can
 * pick one; Auto keeps a chat on Sonnet until it needs Opus, answers a quick
 * message without thinking, and thinks for real work.
 */

export const modelChoices = ["auto", "fable", "opus", "sonnet", "haiku"] as const;
export type ModelChoice = (typeof modelChoices)[number];
export type Model = Exclude<ModelChoice, "auto">;

type Message = { prompt?: string; attachments?: number; building?: boolean; last?: Model | null };

const chosen = (choice: unknown): choice is Model => choice === "fable" || choice === "opus" || choice === "sonnet" || choice === "haiku";

/* What Opus does best: building, code, proofs, explainers that move, long writing. */
const howItWorks = /\bhow (do|does|did|is|are|can)\b.{0,80}\b(work|works|working|made|happen|happens)\b|\bhow .{0,60}\bworks\b/i;
const opusWork = /\b(build|code|coding|program(ming)?|script|debug|bug|refactor|deploy|app|website|web ?site|html|css|javascript|typescript|python|react|sql|prove|proof|derive|animat\w*|visuali[sz]\w*|diagram|simulat\w*|in 3d|video|essay|story)\b/i;

/* Real work Sonnet does well with some thinking: planning, comparing, files, sums. */
const work = /\b(solve|calculate|plan|itinerary|report|analy[sz]e|compare|research|spreadsheet|pdf|document|slides?|deck|chart|graph|step by step|explain)\b/i;

/**
 * How much a message needs, on Auto: quick (a short question, a reply, thanks),
 * work (thinking, or files), opus (what Opus does best) or building (an app's chat).
 */
export function weigh(input: Message): "quick" | "work" | "opus" | "building" {
  if (input.building) return "building";
  const prompt = (input.prompt ?? "").trim();
  /* How something works is shown, not told: an animation, which Opus draws best. */
  if (opusWork.test(prompt) || howItWorks.test(prompt)) return "opus";
  if ((input.attachments ?? 0) > 0 || prompt.length > 280 || prompt.includes("\n\n") || work.test(prompt)) return "work";
  return "quick";
}

/**
 * What the person chose, or on Auto one model for the chat, since switching makes
 * it read the whole chat again: Sonnet, whose first word comes in about a second,
 * until a message needs Opus, and Opus from then on.
 */
export function modelFor(choice: unknown, input: Message = {}): Model {
  if (chosen(choice)) return choice;
  if (input.last === "opus") return "opus";
  const weight = weigh(input);
  return weight === "opus" || weight === "building" ? "opus" : "sonnet";
}

/** Thinking Sonnet and Haiku may be asked for: no more than medium. */
export const lightEfforts = ["low", "medium"] as const;

/**
 * How hard it thinks: on Auto, not at all for a quick message, medium for work,
 * high while building. Otherwise what the person picked, except that Sonnet and
 * Haiku stop at medium.
 */
export function effortFor<E extends string>(model: Model, input: Message & { choice: unknown; effort?: E }): { effort: E | "low" | "medium" | "high" | undefined; thinking: boolean } {
  if (!chosen(input.choice)) {
    const weight = weigh(input);
    if (weight === "quick") return { effort: "low", thinking: false };
    return { effort: weight === "building" && model === "opus" ? "high" : "medium", thinking: true };
  }
  if ((model === "sonnet" || model === "haiku") && input.effort && !(lightEfforts as readonly string[]).includes(input.effort)) return { effort: "medium", thinking: true };
  return { effort: input.effort, thinking: true };
}
