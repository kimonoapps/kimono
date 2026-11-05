import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { accountContext } from "../account-frame";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Password · You" };

export default async function PasswordPage() {
  const { account } = await accountContext();
  return <div className="you" style={{ maxWidth: 560 }}>
    <div className="topbar"><Crossing kind="kakejiku" className="back" href="/account" aria-label="Back to You"><LineIcon name="back" /></Crossing><h1>Password</h1></div>
    <PasswordForm username={account.username} name={account.name} />
  </div>;
}
