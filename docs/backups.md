# Encrypted online backups

Kimono backs up selected application data to a private Backblaze B2 bucket using
restic. Encryption, compression, and deduplication happen on the Kimono server.
The Portal publishes settings and requests; the reconciler performs exports,
uploads, retention, integrity checks, and recovery downloads. The Portal has no
Docker socket.

## Setup

1. Deploy the updated Portal and reconciler images. The reconciler image includes
   restic, SQLite, and tar; it is also the isolated helper used to read volumes.
2. Create a **dedicated private B2 bucket** and an application key scoped to that
   bucket with list, read, write, and delete permissions. Do not use your master
   account key. Use a new repository folder for each Kimono appliance.
3. Open **Admin → Backups** and unfold **Where and when** beneath the app cards.
   Enter the bucket, its HTTPS S3 endpoint, application key ID, and application
   key. Save with the schedule disabled.
4. Download the recovery kit and keep it outside the server, preferably in a
   password manager. It contains the encryption password and B2 credentials.
   Losing the password makes the backups unrecoverable. Anyone with the kit can
   read and delete the repository.
5. Confirm you saved the kit, turn on nightly backups, and save. Each app card
   on the Backups page opens that app's own **Backups** view, where its switch
   and individual items live. Run **Back up now**, then inspect the result.
6. Use **Restore a copy** to exercise recovery before relying on the backups.

Changing the destination or B2 credentials requires saving with the schedule
paused and saving a new recovery kit. The encryption password stays the same.
A first backup initializes a missing repository only when restic reports that
it does not exist. Authentication, connectivity, and password failures never
trigger repository initialization.

The nightly hour is UTC. Defaults retain 7 daily, 4 weekly, and 6 monthly
snapshots. Missed runs catch up after the scheduled hour; failed uploads retry
hourly. Retention runs only after a complete upload. Maintenance failures after
a successful upload are shown separately and retried with the next backup.
Weekly checks read a random 5% of stored data. **Check stored data** reads and
checks the whole repository. Integrity checks do not prove an application can
start from a backup; rehearse the application restore too.

## Choosing contents

Each app chooses what it keeps on its own page (**Admin → Applications → app →
Backups**); the Backups page is a shelf of those pages, stamped with each app's
state, with storage, schedule, and restore folded beneath.
An app's backup switch overrides all its item switches without clearing them.
Turning it back on restores those choices. Disabling an item affects new
snapshots, not previously stored snapshots. Turning off the schedule leaves
manual backups and recovery available.

- **Immich:** database, original photos/videos and profile pictures,
  thumbnails/converted videos, rendered `config.json`, and model cache.
  External libraries are outside these declared volumes and need their own
  backup definition. Keep the database and original files selected together.
- **Pelican:** panel SQLite database, persistent configuration including
  `APP_KEY`, plugins, and logs. External databases and game-server files on Wings
  machines are **not** included. Changing Pelican to an external database requires
  updating its backup declarations; the shipped policy targets its default
  SQLite installation.
- **Forgejo:** SQLite database and the remaining repository/configuration files.
- **Notes:** PostgreSQL database and uploaded attachments. Redis is disposable
  queue/cache state and is not included in its online backup policy.
- **Platform recovery:** Portal settings and secrets (including Drive, Notes
  and Code data), appliance files, custom app definitions, Authentik
  database/data, Headscale database/keys, Watch's nzbdav and AIOStreams
  configuration, Caddy certificates, and the backup schedule and selections
  (without credentials).
  Platform settings include app deployment configuration even if that app's
  data backups are off. Generated Headscale configuration is recreated
  during recovery.

Apps without `spec.backups` are flagged as unprotected. A legacy volume's
`backup: true` alone does not authorize copying a live database. Missing selected
sources cause a failure; Kimono never creates an empty volume to claim success.
Online PostgreSQL exports need the database container running, even if the app
has been disabled in its deployment settings.

## Availability and consistency

Normal backups never stop or pause containers. PostgreSQL uses `pg_dump` in
custom format. SQLite uses its online backup API through `sqlite3 .backup`, then
checks the exported database. Raw SQLite database/WAL files are excluded from
file items. Databases are exported before files, following Immich's documented
online backup order.

A database export is transactionally consistent, but live files and separate
items are not an atomic snapshot. Concurrent file changes can fail a file copy;
deletions during an export may leave database references to unavailable files.
Avoid large imports, migrations, deletions, and repository maintenance during
backup windows. A filesystem snapshot integration or an app-specific coordinated
export is needed for stronger guarantees. This version does not implement ZFS
or Btrfs snapshots.

Exports are staged locally under `${KIMONO_HOME}/backup-work/stage` with private
permissions and uploaded after successful collection. Reserve space roughly
equal to the selected uncompressed data, plus SQLite helper export space.
Staging is plaintext on the server, like the original data; use disk encryption
if local encryption at rest is needed. Completed and failed operations remove
staging; after a killed process the next backup clears it. Recovery downloads
remain until the administrator removes them. Restic encrypts all off-server
backup contents and metadata.

The reconciler serializes scheduled backups with normal deployment work, so
pending deployments wait for the running backup. A filesystem lock prevents
concurrent backup workers. Each operation has a 12-hour timeout. Existing
snapshots are not pruned when an export or upload is incomplete.

Only completed uploads are tagged `kimono` and shown as successful snapshots.
If restic leaves a partial snapshot after a failure, it retains the
`kimono-pending` tag. These are excluded from automatic retention and the Admin
snapshot list; inspect and remove them with restic after resolving the failure
if they are consuming storage.

## Recovery

### On a working appliance

In **Admin → Backups → Where and when → Restore**, choose a snapshot and either the entire
snapshot or one app. Kimono downloads it into a new private directory under
`${KIMONO_HOME}/restores/recovery-*` and asks restic to verify the restored data.
The directory is shown in Admin. This never overwrites live volumes. Selective
restore fails if the chosen snapshot has no data for that app.

Each snapshot contains `manifest.json`, describing selected sources, paths,
methods, application versions, and deployed image references. Files are laid
out as follows:

```text
manifest.json
apps/<app-id>/<item-id>.dump      PostgreSQL custom-format dump
apps/<app-id>/<item-id>.sqlite    Standalone SQLite database
apps/<app-id>/<item-id>.tar       Files relative to the declared volume
apps/<app-id>/<item-id>.json      Rendered settings file
platform/authentik.dump
platform/authentik-data.tar
platform/headscale.sqlite
platform/headscale-files.tar
platform/server.tar
platform/portal.tar
platform/definitions.tar
platform/caddy-data.tar
platform/nzbdav-config.tar
platform/aiostreams-data.tar
platform/backup-settings.json
```

Only selected data appears. Snapshot byte counts are the uncompressed export
size, not B2 billed storage.

The recovery CLI uses the same settings, lock, and status as the worker:

```sh
sudo kimono server backup run
sudo kimono server backup check
sudo kimono server backup restore --snapshot FULL_SNAPSHOT_ID
sudo kimono server backup restore --snapshot FULL_SNAPSHOT_ID --app immich
```

The host CLI needs restic 0.17.1 or later and Docker. On an appliance, the
reconciler container already has the dependencies. The older
`kimono server backup /destination` local archive command remains available;
it is not the new encrypted backup system.

### After losing the server

On a fresh Ubuntu/Debian machine, install the Kimono CLI, copy your recovery
kit over a secure channel, and run one command:

```sh
sudo kimono server restore /safe/kimono-recovery-kit.json
```

It downloads and verifies the latest backup (`--snapshot ID` picks another),
then puts back everything the snapshot holds: server settings and secrets,
Portal data (Drive, Notes, Code and the rest of the built-in apps), app
definitions, Authentik's database and files, Headscale, Watch's nzbdav and
AIOStreams configuration, Caddy's certificates, and every backed-up app's
volumes, SQLite files and PostgreSQL databases. App databases are loaded before
the reconciler starts, so no app ever comes up on an empty database. Backups
reconnect with their saved schedule and selections. If Cloudflare DNS was set
up, the records move to the new machine; otherwise point them at its IP.

Only Docker is needed on the host: restic runs inside the reconciler image. The
command refuses to run over an existing installation or existing volumes;
`--force` replaces them with the backup. The snapshot must include platform
recovery. Data that was not selected for backup (for example Immich previews)
comes back empty and is regenerated by the app.

The manual steps below remain the fallback, for example to restore without the
Kimono CLI. Install restic on a recovery machine. Transfer your recovery kit using a secure
channel. Read its `repository`, `password`, `keyId`, and `applicationKey` into
these environment variables using your password manager or a private shell:

```text
RESTIC_REPOSITORY
RESTIC_PASSWORD
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

Do not put actual credentials in shell history. Then:

```sh
restic snapshots --tag kimono
restic restore FULL_SNAPSHOT_ID --target /safe/recovery --verify
```

Inspect `manifest.json` to see what was captured. Restore first on an isolated
replacement machine and use the recorded application/database image versions.
Recovery can require downtime; normal backups do not.

For a **full appliance restore** with default directories:

1. Install Docker and the Kimono CLI. Keep application containers and the
   reconciler stopped while restoring.
2. Create `/var/lib/kimono` and `/var/lib/kimono-portal` as private directories.
   Extract `platform/server.tar` and `platform/portal.tar` there respectively,
   preserving ownership. Restore `platform/definitions.tar` to the directory
   mounted as `/etc/kimono/app-definitions` (normally the appliance's
   `server/app-definitions` directory). Recreate any custom host bind mounts
   described by the saved Compose configuration.
3. Create the named volumes required by the saved server/app Compose files.
   Restore `authentik-data.tar` into `kimono-server_authentik_data`, and restore
   `headscale-files.tar` plus `headscale.sqlite` as `db.sqlite` in
   `kimono-server_headscale_data`. Use empty volumes and preserve the UID/GID
   expected by each container. Do not restore old SQLite WAL/SHM files.
4. Start only the server PostgreSQL service. Restore `authentik.dump` using
   `pg_restore --clean --if-exists --exit-on-error --no-owner` into the Authentik
   database, using the database name/user from the saved server environment.
   Keep Authentik itself stopped during this step.
5. Restore selected app data as described below. Generated app settings and
   secrets are also present in the saved appliance/Portal files. Start the
   platform and validate sign-in, mesh connectivity, and app data before enabling
   public access and the reconciler.
6. Import access with `sudo kimono server backup import-kit /safe/kimono-recovery-kit.json`,
   then review the app selections in Admin before enabling scheduling again.
   The backup control directory is deliberately excluded from platform archives;
   the recovery kit is your independent access path. Do not initialize an
   existing repository with a newly generated password.

For **each application restore**:

1. Stop that application's writers and save a copy of any current data before
   replacing it. Check its recorded version and source definitions in the
   manifest; do not combine unrelated snapshots.
2. Extract each `.tar` into the named volume recorded for that item. Paths inside
   the archive are relative to the volume root. Restore on empty volumes where
   possible, preserving file ownership and permissions.
3. For SQLite, place the standalone `.sqlite` export at the recorded source
   path within its volume. Restore its normal ownership and remove any stale
   WAL/SHM/journal companions from the destination before starting the app.
4. For PostgreSQL, start only its database service and import the `.dump` with
   `pg_restore --clean --if-exists --exit-on-error --no-owner --username USER
   --dbname DATABASE`. The server must include the same required extensions.
5. Restore rendered settings files and encryption keys together with the data.
   Immich's settings file lives at
   `${KIMONO_HOME}/apps/apps/<app-id>-settings.json`; Pelican needs the saved
   `.env`/`APP_KEY` from its configuration item.
6. Start the app and verify data and sign-in. For Immich, verify originals and
   albums; regenerate excluded thumbnails/conversions. For Pelican, verify node
   configuration separately from actual Wings game data.

Automatic replacement of live application volumes is intentionally not part of
**Restore a copy**. Its output is a verified export ready for the documented
application-specific recovery steps.

## App definition contract

`spec.backups` declares independently selectable items. Each item has a stable
`id`, `label`, `description`, `enabledByDefault`, and `method`. No arbitrary host
commands or host paths are accepted.

```json
{
  "backups": [
    {
      "id": "database",
      "label": "Photo database",
      "description": "Albums, users, and asset references. Pair with originals.",
      "enabledByDefault": true,
      "method": "postgres",
      "service": "database",
      "database": "immich",
      "username": "immich"
    },
    {
      "id": "originals",
      "label": "Photos and videos",
      "description": "Original media files.",
      "enabledByDefault": true,
      "method": "files",
      "volume": "library",
      "paths": ["library", "upload", "profile"]
    },
    {
      "id": "config",
      "label": "Configuration (config.json)",
      "description": "Rendered settings and sign-in configuration.",
      "enabledByDefault": true,
      "method": "settings"
    }
  ]
}
```

- `files`: existing declared volume, relative `paths`, optional relative
  `exclude` patterns. Exclude databases and journal files handled by another item.
- `sqlite`: existing declared volume and exactly one relative database path.
- `postgres`: declared service, database, and username. Uses local authentication
  inside the database container; password prompting is disabled.
- `settings`: the app's existing `spec.settingsFile` rendered by Kimono.

The app SDK's launcher manifest is separate from this stack definition contract.
Backup declarations belong to `app.json`, next to services and storage.

## Verification

```sh
go test ./...
pnpm typecheck
# Optional real encrypted local round trip (no B2 account needed):
KIMONO_TEST_RESTIC=/path/to/restic go test ./cli/internal/backup -run TestResticRoundTrip -v
```

The integration test creates an encrypted repository, backs up a configuration,
selectively restores and verifies it, and checks that a wrong password fails.
It does not exercise a real B2 account or every upstream app's restore process.

The SQLite test also exports a live database with committed data still in its
WAL file. Reference behavior: [restic scripting](https://restic.readthedocs.io/en/stable/075_scripting.html),
[Immich backup ordering](https://docs.immich.app/administration/backup-and-restore/),
and [Pelican's Docker storage](https://pelican.dev/docs/panel/advanced/docker/).
