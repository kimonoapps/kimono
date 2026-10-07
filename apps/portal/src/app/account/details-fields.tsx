"use client";

import { useState } from "react";
import { Field } from "@kimono/ui";

/** Name and email. Changing the email asks for the current password, because resets go there. */
export function DetailsFields({ name, email, username }: { name: string; email: string; username: string }) {
  const [nextEmail, setNextEmail] = useState(email);
  const changingEmail = nextEmail.trim().toLowerCase() !== email.trim().toLowerCase();
  return <>
    <Field label="Name"><input name="name" defaultValue={name} maxLength={80} autoComplete="name" required /></Field>
    <Field label="Email"><input name="email" type="email" value={nextEmail} onChange={(event) => setNextEmail(event.target.value)} maxLength={254} autoComplete="email" required /></Field>
    {changingEmail ? <Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required /></Field> : null}
    <div className="k-field"><span>Username</span><span className="account-fixed">@{username}</span></div>
  </>;
}
