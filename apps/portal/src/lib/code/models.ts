/*
 * Which Claude answers (docs/kimono-ai.md, "Choosing the model"). People can
 * pick one; Auto is Opus at medium thinking, every message.
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

/**
 * How hard it thinks: on Auto, medium every message so the chat stays cached.
 * Otherwise what the person picked, except that Sonnet and Haiku stop at medium.
 */
export function effortFor<E extends string>(model: Model, input: { choice: unknown; effort?: E }): E | "low" | "medium" | "high" | undefined {
  const auto = !(input.choice === "fable" || input.choice === "opus" || input.choice === "sonnet" || input.choice === "haiku");
  if (auto) return "medium";
  if ((model === "sonnet" || model === "haiku") && input.effort && !(lightEfforts as readonly string[]).includes(input.effort)) return "medium";
  return input.effort;
}
