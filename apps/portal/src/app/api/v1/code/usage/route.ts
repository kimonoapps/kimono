import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, usageOf } from "@/lib/code";

/** The signed-in person's use of the Claude plan behind Code: this 5-hour window and this week, against their share. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, (config) => {
    const used = usageOf(db(), user.username);
    const unlimited = user.role === "owner";
    return apiJson({
      model: "Opus 5.5",
      unlimited,
      reported: used.reported,
      plan: used.plan,
      fiveHourLimited: used.fiveHourLimited,
      fiveHour: { used: used.fiveHour.used, share: unlimited ? 1 : config.shares.fiveHour, resetsAt: used.fiveHour.resetsAt },
      week: { used: used.week.used, share: unlimited ? 1 : config.shares.week, resetsAt: used.week.resetsAt },
    });
  });
}
