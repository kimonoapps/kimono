import { Compartment, Tray } from "@kimono/ui";
import { CrossingSeal } from "@/components/crossing";
import { passwordChangeUrl } from "@/lib/account";
import { AccountFrame, accountContext } from "../account-frame";

export const metadata = { title: "Password · Your account" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const { session, account } = await accountContext();
  const query = await searchParams;
  const changeUrl = passwordChangeUrl();

  return <AccountFrame here="password" account={account} user={session.user}>
    {query.changed ? <p className="admin-notice success">Your password was changed.</p> : null}
    <Tray>
      <header className="account-heading"><h2>Password</h2></header>
      <Compartment label="Change it">
        <div className="k-form-actions account-actions">
          {changeUrl
            ? <CrossingSeal kind="hanafubuki" href={changeUrl}>Change password</CrossingSeal>
            : <><button className="k-seal" type="button" disabled>Change password</button><span className="k-note">Password changes aren&apos;t available right now.</span></>}
        </div>
      </Compartment>
    </Tray>
  </AccountFrame>;
}
