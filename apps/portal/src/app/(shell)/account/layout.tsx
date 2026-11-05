import type { ReactNode } from "react";
import { AccountFrame, accountContext } from "./account-frame";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const { session, account } = await accountContext();
  return <AccountFrame account={account} user={session.user}>{children}</AccountFrame>;
}
