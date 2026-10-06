import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { Portrait } from "@/components/portrait";
import { readAccount, type AccountProfile } from "@/lib/account";
import { getPlatformSettings } from "@/lib/settings";
import "./account.css";

/** Every account page is the signed-in person's, and nobody else's. */
export async function accountContext() {
  const session = await auth();
  if (!session?.user?.username) redirect("/login");
  return { session, account: await readAccount(session.user) };
}

const rooms = [
  { id: "profile", href: "/account", label: "Profile" },
  { id: "password", href: "/account/password", label: "Password" },
  { id: "devices", href: "/account/devices", label: "Signed-in devices" },
] as const;

/**
 * 己 The account's frame: the same rail-and-panel composition as an app's
 * settings, with the person's own picture standing at the top of the rail so
 * it is in view on every account page.
 */
export async function AccountFrame({ here, account, user, children }: {
  here: (typeof rooms)[number]["id"];
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
          <nav className="rail-nav" aria-label="Your account">
            {rooms.map((room) => <Crossing key={room.id} kind="kakejiku" href={room.href} aria-current={room.id === here ? "page" : undefined}>{room.label}</Crossing>)}
          </nav>
        </aside>
        <div className="app-panel">{children}</div>
      </div>
    </div>
  </AppShell>;
}
