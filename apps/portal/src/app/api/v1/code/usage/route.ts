import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, usageOf } from "@/lib/code";
import { chatSpent, holdMediaBudget } from "@/lib/code/media";
import { portalOrigin } from "@/lib/account";

/** The signed-in person's use of the Claude plan behind Code (this 5-hour window and this week, against their share), and of this month's Pro Tools allowance. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    const used = usageOf(db(), user.username);
    const media = await holdMediaBudget(db(), config, user.username, portalOrigin()).catch(() => null);
    /* ?chat=<id>: also what that chat of theirs spent, so it can say so even under half the allowance. */
    const chat = new URL(request.url).searchParams.get("chat");
    const inChat = media && chat && /^[A-Za-z0-9_-]{1,80}$/.test(chat) && db().prepare("SELECT 1 FROM workspaces WHERE id = ? AND owner = ?").get(chat, user.username.toLowerCase()) ? chatSpent(db(), chat, user.username) : 0;
    const unlimited = user.role === "owner";
    return apiJson({
      model: "Opus 5.5",
      unlimited,
      reported: used.reported,
      plan: used.plan,
      fiveHourLimited: used.fiveHourLimited,
      fiveHour: { used: used.fiveHour.used, share: unlimited ? 1 : config.shares.fiveHour, resetsAt: used.fiveHour.resetsAt },
      week: { used: used.week.used, share: unlimited ? 1 : config.shares.week, resetsAt: used.week.resetsAt },
      media: media && media.budget > 0 ? { budget: media.budget, spent: media.spent, resetsAt: media.resetsAt, chatSpent: inChat } : null,
    });
  });
}
