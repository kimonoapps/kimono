import { Compartment, Tray } from "@kimono/ui";
import { accountContext } from "../account-frame";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Password · Your account" };

export default async function PasswordPage() {
  const { account } = await accountContext();
  return <Tray>
    <header className="account-heading"><h2>Password</h2></header>
    <Compartment label="Change password">
      <PasswordForm username={account.username} name={account.name} />
    </Compartment>
  </Tray>;
}
