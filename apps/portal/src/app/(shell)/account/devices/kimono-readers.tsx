import { redirect } from "next/navigation";
import { InkBlot, Seal } from "@kimono/ui";
import { LineIcon } from "@/components/line-icon";
import { auth } from "@/auth";
import { listReaders, renameReader, revokeReader, ReadProblem } from "@/lib/kimono-read";

const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }) : "not yet";

/** Kimono Read e-readers paired with this account: rename or unpair. */
export async function KimonoReaders({ username }: { username: string }) {
  const readers = listReaders(username);

  async function act(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    const id = String(form.get("id") || "");
    try {
      if (form.get("unpair")) revokeReader(current.user.username, id);
      else renameReader(current.user.username, id, form.get("name"));
    } catch (error) {
      redirect(`/account/devices?error=${encodeURIComponent(error instanceof ReadProblem ? error.message : "That reader couldn't be changed.")}`);
    }
    redirect("/account/devices");
  }

  return <section style={{ marginTop: 28 }}>
    <h2 style={{ font: "inherit", fontWeight: 600, padding: "0 0 8px 12px", margin: 0 }}>Kimono Read</h2>
    <p style={{ color: "var(--on-surface-variant)", padding: "0 0 14px 12px", margin: 0 }}>
      {readers.length ? "E-readers paired with your Kimono. Unpairing one signs it out at once." : <>No e-reader is paired. <a href="/read/setup">Set up Kimono Read</a></>}
    </p>
    {readers.length ? <div className="seg">{readers.map((reader) => <div className="row" key={reader.id}>
      <InkBlot tint="#5c4f7a" seed={reader.id}><LineIcon name="book" /></InkBlot>
      <form action={act} className="text" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={reader.id} />
        <span style={{ flex: 1, minWidth: 160 }}>
          <input name="name" defaultValue={reader.name} aria-label="Reader name" maxLength={60} style={{ font: "inherit", fontWeight: 600, border: 0, background: "transparent", color: "inherit", width: "100%" }} />
          <small style={{ display: "block" }}>Paired {when(reader.pairedAt)} · last synced {when(reader.lastSeen)}</small>
        </span>
        <Seal compact type="submit">Rename</Seal>
        <Seal tone="danger" compact type="submit" name="unpair" value="1">Unpair</Seal>
      </form>
    </div>)}</div> : null}
  </section>;
}
