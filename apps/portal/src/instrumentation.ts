/**
 * The reconciler applies whatever plan is on disk, so the Portal republishes its
 * desired state at boot. A fresh container therefore converges without anyone
 * opening the Admin portal or running a command.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getPlatformSettings }, { publishDesiredState }] = await Promise.all([import("./lib/settings"), import("./lib/desired-state")]);
  try {
    const { digest } = await publishDesiredState(await getPlatformSettings());
    console.log(`kimono: published deployment plan ${digest}`);
  } catch (error) {
    console.error("kimono: could not publish the deployment plan", error);
  }
  /* Notes people left in Outline, when `kimono server import-outline` has put them out. */
  const { importOutlineIfWaiting } = await import("./lib/notes/outline-import-run");
  await importOutlineIfWaiting();
  /* TestFlight follows Kimono's accounts on its own: checked every quarter hour, synced when an hour has passed. */
  const { syncTestflightIfDue } = await import("./lib/testflight");
  setInterval(() => { void syncTestflightIfDue().catch(() => {}); }, 15 * 60 * 1000).unref();
  setTimeout(() => { void syncTestflightIfDue().catch(() => {}); }, 60 * 1000).unref();
}
