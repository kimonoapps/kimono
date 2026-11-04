import { cache, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { readAccount, type AccountProfile } from "@/lib/account";
import { getPlatformSettings } from "@/lib/settings";
import { AccountCard } from "./account-rooms";
import "./account.css";

/** Every account page is the signed-in person's, and nobody else's. Read once per request. */
export const accountContext = cache(async () => {
  const session = await auth();
  if (!session?.user?.username) redirect("/login");
  return { session, account: await readAccount(session.user) };
});

/**
 * 己 You: one centred column like the phone's You screen. The hub lists the
 * account's places; each opens as its own page with a way back.
 */
export async function AccountFrame({ account, user, children }: {
  account: AccountProfile;
  user: Parameters<typeof AppShell>[0]["user"];
  children: ReactNode;
}) {
  const settings = await getPlatformSettings();
  return <AppShell user={{ ...user, name: account.name, image: account.picture }} brandColors={settings.brand.colors} active="account">
    <div className="page account-page"><AccountCard>{children}</AccountCard></div>
  </AppShell>;
}
