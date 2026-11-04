"use client";

import { useState } from "react";

/** Name and email. Changing the email asks for the current password, because resets go there. */
export function DetailsFields({ name, email, username }: { name: string; email: string; username: string }) {
  const [nextEmail, setNextEmail] = useState(email);
  const changingEmail = nextEmail.trim().toLowerCase() !== email.trim().toLowerCase();
  return <>
    <label className="field"><small>Name</small><input name="name" defaultValue={name} maxLength={80} autoComplete="name" required /></label>
    <label className="field"><small>Email</small><input name="email" type="email" value={nextEmail} onChange={(event) => setNextEmail(event.target.value)} maxLength={254} autoComplete="email" required /></label>
    {changingEmail ? <label className="field"><small>Current password</small><input name="currentPassword" type="password" autoComplete="current-password" required /></label> : null}
    <p style={{ color: "var(--on-surface-variant)", fontSize: 14 }}>Your username, @{username}, stays the same.</p>
  </>;
}
