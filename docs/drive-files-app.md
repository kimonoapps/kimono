# Kimono Drive in the Files app

Kimono Drive must show up in the system file browser on both phones, beside iCloud Drive, and behave like iCloud: browse without the Kimono app open, open and save files in place from any app, keep files offline, and see changes from other people without asking.

## iPhone: a File Provider extension

- **Built in Swift, not Compose.** It is a `NSFileProviderReplicatedExtension`, a separate process with tight memory limits that the system starts on its own. It is small: it maps Drive's API onto the system's calls. The Kimono app around it stays Compose.
- **Sign-in is shared through the Keychain.** The app and the extension use one Keychain access group and one App Group, so signing in to the app signs in the Files app, and signing out signs out both. The extension refreshes tokens itself.
- **Mapping:**
  - The Kimono root is the list of spaces, and each space's top folder sits under it.
  - Item ids are node ids.
  - `itemVersion` is `contentVersion` plus `version`.
  - A role that drops below editor makes items read-only.
  - The Drive trash maps to the system trash container.
- **Server endpoints it uses:**
  - **Listing:** `GET /api/v1/drive/spaces` and `GET /api/v1/drive/nodes/:id`.
  - **Sync:** `GET /api/v1/drive/changes?since=` returns sync anchors. A 410 means the anchor expired, so the extension lists everything again.
  - **Downloads:** `GET …/content`, with ranges and ETag.
  - **New files:** tus uploads, background `URLSession` and pieces of 50 MB or less.
  - **Saving in place:** a tus upload with `replaces` and `base`. A clash is kept as "name (edited elsewhere)" and never overwrites the other edit.
  - **Edits:** `PATCH /nodes/:id` for rename and move, `DELETE` for trash.
- **Instant updates need push:**
  - **Why:** without push, the Files app only notices other people's changes when it next asks.
  - **What's needed:** an APNs key (`.p8`) from the Apple developer account. The Portal then sends a File Provider push to each signed-in iPhone after every change.
  - **Not built yet:** this needs the app to exist first, and the key would be new configuration on the server.
- **Distribution:** File Provider extensions work under TestFlight like the app. Both need the App Group and Keychain sharing capabilities.

## Android: a DocumentsProvider

The same server endpoints serve Android's Storage Access Framework, which puts Kimono in the Files app and every system file picker:
- **Content:** opening a document streams its content.
- **Saving:** writing back uses the same replace-with-conflict upload.
- **Updates:** change notifications come from the same change feed.

## Order

1. Drive screens in the Kimono app, with background uploads.
2. Android DocumentsProvider. It can be built and tested now on the emulator.
3. iPhone File Provider extension, once Xcode is installed.
4. Push for instant updates.
