import { cache, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Portrait } from "@/components/portrait";
import { readAccount, type AccountProfile } from "@/lib/account";
import { getPlatformSettings } from "@/lib/settings";
import { AccountCard, AccountRooms } from "./account-rooms";
import "./account.css";

/** Every account page is the signed-in person's, and nobody else's. Read once per request. */
export const accountContext = cache(async () => {
  const session = await auth();
  if (!session?.user?.username) redirect("/login");
  return { session, account: await readAccount(session.user) };
});

/**
 * 己 The account's frame: the same rail-and-panel composition as an app's
 * settings, with the person's own picture at the top of the rail. It is the
 * section's layout, so moving between its rooms changes only the card.
 */
export async function AccountFrame({ account, user, children }: {
  account: AccountProfile;
  user: Parameters<typeof AppShell>[0]["user"];
  children: ReactNode;
}) {
  const settings = await getPlatformSettings();
  return <AppShell user={{ ...user, name: account.name, image: account.picture }} brandColors={settings.brand.colors} active="account">
    <div className="page admin-page account-page">
      <div className="app-workspace">
        <aside className="app-rail">
          <div className="rail-identity account-identity">
            <Portrait name={account.name} username={account.username} picture={account.picture} size={72} />
            <h1>{account.name}</h1>
            <p>@{account.username} · {account.role}</p>
          </div>
          <AccountRooms />
        </aside>
        <div className="app-panel"><AccountCard>{children}</AccountCard></div>
      </div>
    </div>
  </AppShell>;
}
