import { Choice, Seal } from "@kimono/ui";
import { Portrait } from "@/components/portrait";
import { listAccounts } from "@/lib/directory";
import { picturePaths } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { codeConfig } from "@/lib/code/config";
import { creditGrants, db, usageGrants, usageOf } from "@/lib/code";
import { lastAllowance } from "@/lib/code/media";

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
const credits = (dollars: number) => `${Math.round(dollars * 100).toLocaleString("en")} credits`;
const day = (at: number) => new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Each person's use of Kimono AI this week and these 5 hours, and more of either to give them. */
export async function AiUsage({ give, takeBack, giveCredits, takeBackCredits, me }: { give: (form: FormData) => Promise<void>; takeBack: (form: FormData) => Promise<void>; giveCredits: (form: FormData) => Promise<void>; takeBackCredits: (form: FormData) => Promise<void>; me: { username: string; role?: string } }) {
  const [accounts, pictures, settings] = await Promise.all([listAccounts(), picturePaths(), getPlatformSettings()]);
  const config = codeConfig(settings);
  const grants = usageGrants(db()), given = creditGrants(db());
  if (!accounts.length) return <p className="lead">Nobody has signed in yet.</p>;
  return <div className="seg ai-usage">
    {accounts.map((account) => {
      const key = account.username.toLowerCase();
      const used = usageOf(db(), key);
      const theirs = grants.filter((g) => g.username === key), theirCredits = given.filter((g) => g.username === key);
      const extraCredits = theirCredits.reduce((total, g) => total + g.dollars, 0);
      const spent = lastAllowance(key)?.spent;
      const creditLine = config.mediaBudget + extraCredits > 0 ? `${spent == null ? "" : `${credits(spent)} of `}${credits(config.mediaBudget + extraCredits)} this month` : null;
      const extra = (window: "week" | "five_hour") => theirs.filter((g) => g.window === window).reduce((total, g) => total + g.extra, 0);
      const unlimited = key === me.username.toLowerCase() && me.role === "owner";
      const line = unlimited ? "Not limited"
        : [
          `${pct(used.week.used)} of ${pct(config.shares.week + extra("week"))} this week`,
          used.fiveHourLimited ? `${pct(used.fiveHour.used)} of ${pct(config.shares.fiveHour + extra("five_hour"))} these 5 hours` : null,
          creditLine,
        ].filter(Boolean).join(" · ");
      return <div className="row" key={key}>
        <Portrait name={account.name} username={account.username} picture={pictures[key]} size={40} />
        <span className="text">
          <b>{account.name || account.username}</b>
          <small>{line}</small>
          {theirs.map((g) => <form key={g.id} action={takeBack} className="ai-grant">
            <input type="hidden" name="grant" value={g.id} />
            <small>+{pct(g.extra)} {g.window === "week" ? "this week" : "these 5 hours"}, until {day(g.until)}</small>
            <button type="submit" className="txt">Take back</button>
          </form>)}
          {theirCredits.map((g) => <form key={`c${g.id}`} action={takeBackCredits} className="ai-grant">
            <input type="hidden" name="grant" value={g.id} />
            <small>+{credits(g.dollars)} this month, until {new Date(g.until).toLocaleDateString("en", { month: "long", day: "numeric", timeZone: "UTC" })}</small>
            <button type="submit" className="txt">Take back</button>
          </form>)}
        </span>
        {unlimited ? null : <div className="ai-gives"><form action={give} className="ai-give">
          <input type="hidden" name="username" value={key} />
          <Choice compact name="extra" aria-label="How much more" defaultValue="20"
            options={[10, 20, 50, 100].map((n) => ({ value: String(n), label: `+${n}%` }))} />
          <Choice compact name="window" aria-label="For" defaultValue="week"
            options={[{ value: "week", label: "This week" }, ...(used.fiveHourLimited ? [{ value: "five_hour", label: "These 5 hours" }] : [])]} />
          <Seal type="submit" compact>Give</Seal>
        </form>
        {!config.composioKey ? null : <form action={giveCredits} className="ai-give">
          <input type="hidden" name="username" value={key} />
          <Choice compact name="credits" aria-label="How many credits" defaultValue="1000"
            options={[500, 1000, 2500, 5000].map((n) => ({ value: String(n), label: `+${n.toLocaleString("en")} credits` }))} />
          <Seal type="submit" compact>Give</Seal>
        </form>}</div>}
      </div>;
    })}
  </div>;
}
