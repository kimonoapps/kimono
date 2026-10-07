import { revalidatePath } from "next/cache";
import { Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { dismissUpdate, updateNotice } from "@/lib/kimono-release";

/**
 * In the header of the admin pages when a newer Kimono has been released.
 * The Portal can't update the server it runs on, so it says what to run.
 * "Don't show again" lasts until the release after this one.
 */
export async function UpdateBanner({ username }: { username: string }) {
  const notice = await updateNotice(username);
  if (!notice) return null;

  async function dismiss() {
    "use server";
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user?.username || (role !== "owner" && role !== "admin")) return;
    await dismissUpdate(session.user.username, notice!.latest);
    revalidatePath("/admin", "layout");
  }

  /* A seal in the header, beside the account menu: the house's action colour
     for the one thing an admin should act on. Pressing it opens the details. */
  return (
    <details className="update-menu">
      <summary className="k-seal k-compact update-seal" aria-label={`New version available: ${notice.latest}`}>
        <span>New version</span>
        <span className="update-seal-versions"><span className="update-seal-from">{notice.current} → </span>{notice.latest}</span>
      </summary>
      <div className="update-popover">
        <div className="update-popover-head">
          <strong>Kimono {notice.latest}</strong>
          <small>You have {notice.current}</small>
        </div>
        <p>Run this on the Kimono server:</p>
        <code>sudo kimono update</code>
        <div className="update-popover-actions">
          {/* eslint-disable-next-line no-restricted-syntax -- release notes open beside the admin page, in a new tab; there is no crossing to make. */}
          <a href={notice.url} target="_blank" rel="noreferrer">What’s new ↗</a>
          <form action={dismiss}><Seal tone="quiet" compact type="submit">Don’t show again</Seal></form>
        </div>
      </div>
    </details>
  );
}
