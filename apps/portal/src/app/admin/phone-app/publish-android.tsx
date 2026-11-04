"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Form, FormActions, Seal } from "@kimono/ui";

/**
 * Publishing an Android version: the APK goes up with its version, build and
 * notes. Sent by hand rather than as a form action, so a large package shows
 * how far it has got and isn't held to a server action's size limit.
 */
export function PublishAndroid({ nextBuild }: { nextBuild: number }) {
  const router = useRouter();
  const [sent, setSent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/app-releases");
    request.upload.onprogress = (progress) => { if (progress.lengthComputable) setSent(progress.loaded / progress.total); };
    request.onload = () => {
      setSent(null);
      const answer = (() => { try { return JSON.parse(request.responseText) as { error?: string }; } catch { return {}; } })();
      if (request.status === 201) { form.reset(); setProblem(null); router.refresh(); }
      else setProblem(answer.error || "That version couldn't be published.");
    };
    request.onerror = () => { setSent(null); setProblem("The Portal didn't answer. Try again."); };
    setProblem(null);
    setSent(0);
    request.send(new FormData(form));
  }

  return <Form onSubmit={publish}>
    <Field label="APK"><input type="file" name="apk" accept=".apk,application/vnd.android.package-archive" required /></Field>
    <Field label="Version"><input name="version" placeholder="0.2.0" required autoComplete="off" /></Field>
    <Field label="Build"><input name="build" type="number" min={nextBuild} defaultValue={nextBuild} required /></Field>
    <Field label="What's new"><textarea name="notes" rows={3} placeholder="Optional. Shown when the app offers the update." /></Field>
    <Field label="Required, so phones on an older version must update to keep using Kimono"><input type="checkbox" name="required" /></Field>
    {problem ? <p className="admin-notice error">{problem}</p> : null}
    <FormActions>
      <Seal type="submit" disabled={sent !== null}>{sent === null ? "Publish" : `Sending ${Math.round(sent * 100)}%`}</Seal>
    </FormActions>
  </Form>;
}
