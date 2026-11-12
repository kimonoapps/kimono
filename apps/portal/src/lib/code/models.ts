/*
 * Which Claude answers (docs/kimono-ai.md, "Choosing the model"). People can
 * pick one; Auto is Opus, thinking as hard as each message needs.
 */

export const modelChoices = ["auto", "fable", "opus", "sonnet", "haiku"] as const;
export type ModelChoice = (typeof modelChoices)[number];
export type Model = Exclude<ModelChoice, "auto">;

/** What the person chose, or Opus when they chose Auto (or nothing). */
export function modelFor(choice: unknown, _input?: unknown): Model {
  return choice === "fable" || choice === "opus" || choice === "sonnet" || choice === "haiku" ? choice : "opus";
}

/** Thinking Sonnet and Haiku may be asked for: no more than medium. */
export const lightEfforts = ["low", "medium"] as const;

/* A message that asks for real work: something to build, fix, prove, plan or make. */
const heavy = /\b(build|code|program|script|debug|fix|refactor|deploy|app|website|prove|derive|solve|calculate|plan|itinerary|essay|report|analy[sz]e|compare|research|spreadsheet|pdf|document|slides?|deck|animat\w*|visuali[sz]\w*|diagram|chart|graph|simulat\w*|video|step by step)\b/i;

/**
 * How hard Auto thinks for a message: low for a quick one, so the answer starts at
 * once; medium for real work or anything with files; high while building an app.
 * The system prompt and tools stay cached whichever it picks.
 */
export function autoEffort(input: { prompt: string; attachments?: number; building?: boolean }): "low" | "medium" | "high" {
  if (input.building) return "high";
  const prompt = input.prompt.trim();
  if ((input.attachments ?? 0) > 0 || prompt.length > 280 || prompt.includes("\n\n") || heavy.test(prompt)) return "medium";
  return "low";
}

/**
 * How hard it thinks: on Auto, what the message needs (autoEffort). Otherwise what
 * the person picked, except that Sonnet and Haiku stop at medium.
 */
export function effortFor<E extends string>(model: Model, input: { choice: unknown; effort?: E; prompt?: string; attachments?: number; building?: boolean }): E | "low" | "medium" | "high" | undefined {
  const auto = !(input.choice === "fable" || input.choice === "opus" || input.choice === "sonnet" || input.choice === "haiku");
  if (auto) return autoEffort({ prompt: input.prompt ?? "", attachments: input.attachments, building: input.building });
  if ((model === "sonnet" || model === "haiku") && input.effort && !(lightEfforts as readonly string[]).includes(input.effort)) return "medium";
  return input.effort;
}
