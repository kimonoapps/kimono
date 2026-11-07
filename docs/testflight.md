# TestFlight testers

The Portal keeps the iPhone apps' TestFlight testers in step with Kimono's accounts (`apps/portal/src/lib/testflight.ts`, rules in `testflight-plan.ts`). It uses the App Store Connect API key given under **Admin → Phone app**, stored in the Portal's state dir (`testflight.json`), never shown again. CI has its own copy (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY` secrets) for uploads only.

## Asking and approval

Nobody is invited until they ask and an admin approves, one app at a time (Kimono, Kimono Photos):

- **People ask** for each app on **Get the app** on their iPhone, or from that app's screen in the Kimono app (`POST /api/v1/app/testflight`, `{ "app": "app.kimono.photos" }`; the Kimono app when left out). `GET` answers where they stand with each app.
- **Admins answer** under **Asking for the iPhone apps** on **Admin → Phone app**. Approving sends the invite straight away; declining lets them ask again later.

Requests live in `testflight.json` (`requests`, by username and bundle ID). People who had asked before approval existed count as approved for Kimono only. Anyone already in an app's group stays there.

## Sync

Runs every hour on its own, after an approval, and from **Sync now** on the admin page. It:

- invites anyone approved for an app (with Kimono access and an email) to the App Store Connect team,
- adds them to the `Kimono` internal group of each app they were approved for once they accept, which sends TestFlight's invite,
- takes off only people the Portal itself invited, when their Kimono access ends.

Sync never sends anyone a second email. People whose invite needs resending show as stuck:

| Status | Meaning |
|---|---|
| `invited (waiting to accept)` | Apple's team invite was sent and is still valid |
| `invite expired` | Apple's team invite expired before they accepted |
| `tester (not accepted)` | In the group, but TestFlight's invite is still unanswered (`betaTester.state` is `INVITED`) |

## Re-inviting

- **The person themself:** on **Get the app** on their iPhone, **Send it again** appears beside **Check again** while they're invited or stuck (`POST /api/v1/app/testflight/resend`).
- **An admin:** on **Admin → Phone app**, **Re-invite** on a stuck row, or **Re-invite stuck** for everyone at once.

A re-invite replaces a pending or expired team invite with a new one (Apple emails them again). For someone already on the team it resends TestFlight's invite for each app whose group they're in (`POST /v1/betaTesterInvitations`). The same person can't be sent another within ten minutes. A sync runs afterwards so the statuses are current.

## Inviting at a different email

Apple only lets someone accept at an Apple Account under the exact email the invite went to. When their Apple Account uses another address, the acceptance page keeps asking them to sign in again. To fix that, invite them at their Apple Account's email instead:

- **The person themself:** **Use a different email** under Request access on **Get the app** (`POST /api/v1/app/testflight/email`, `{ "email": "…" }`; an empty email goes back to their Kimono email).
- **An admin:** **Change email** on their row on **Admin → Phone app**; clearing it goes back to their Kimono email.

It's kept per person in `testflight.json` (`appleEmails`). The sync that follows cancels what the Portal sent to the old email, or takes that address off the team if it was already accepted, and invites the new one. When their Kimono access ends, the new address is taken off like any other.

