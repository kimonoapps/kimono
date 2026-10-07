import { revalidatePath } from "next/cache";
import { Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { dismissUpdate, updateNotice } from "@/lib/kimono-release";

/**
 * Across the top of the admin pages when a newer Kimono has been released.
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

  return (
    <aside className="update-banner" aria-label="New version available">
      <div className="update-banner-inner">
        <p className="update-banner-what">
          <strong>New version available</strong>
          <span className="update-banner-versions"><span>{notice.current}</span><span aria-label="to">→</span><b>{notice.latest}</b></span>
          {/* eslint-disable-next-line no-restricted-syntax -- release notes open beside the admin page, in a new tab; there is no crossing to make. */}
          <a href={notice.url} target="_blank" rel="noreferrer">What’s new ↗</a>
        </p>
        <div className="update-banner-how">
          <code title="Run on the Kimono server">sudo kimono update</code>
          <form action={dismiss}><Seal tone="quiet" compact type="submit">Don’t show again</Seal></form>
        </div>
      </div>
    </aside>
  );
}
