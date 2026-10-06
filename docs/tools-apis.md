# Kimono Tools APIs

Tools runs inside the portal. It uses the same app definition, saved configuration, and enabled state as other Kimono applications. Starting setup saves configuration; it does not install a separate service. Nothing is automatically enabled.

## Configure and use

1. Open Administration → Applications → Kimono Tools, start setup, and enable Tools in Setup.
2. Open Tools. Select an API in Collections; documentation and endpoint access states appear immediately.
3. For protected endpoints, use **Create API key** at the top right of the selected API. The drawer saves a cryptographically generated key on the server and reveals it once. Copy it before closing. **Manage API key** offers explicit replacement and revocation. Replacement invalidates the old key; revocation disables protected endpoints and preserves public endpoints.
4. In **API configuration**, enable the API and choose access for each endpoint: `disabled`, `public`, or `api-key`. Endpoints default to disabled. Key management uses the same saved secret configuration as this form.
5. Expand an endpoint to see its parameters, request preview, and response documentation. Parameters read as a table; **Try request** turns them into fields and **Execute request** sends the call. For key-protected endpoints an **Authorization** field appears beside the parameters; the key it holds stays in the page's memory, is shared by every endpoint on the page, and never changes saved configuration. The curl example updates as parameters change and uses a placeholder for secrets. A disabled API is announced once under its heading, with the code it returns; each row states its own access.
6. Download the OpenAPI 3.1 document from the collection rail, or request `/api/tools/openapi.json`.


Public endpoints permit anonymous HTTP requests. Protected endpoints require `Authorization: Bearer YOUR_API_KEY`; signing into the portal does not bypass this. Keys apply to protected endpoints of their API only. Keys are not accepted in URLs. Existing secret values are never sent to the documentation or input components. The tester keeps a supplied key in page memory only. Saved credentials use Kimono's existing secret configuration storage; they are not user-specific tokens.

## Mawaqit

- `GET /api/tools/mawaqit/search?q=Paris` searches by name or city. Alternatively supply both `lat` and `lon`.
- `GET /api/tools/mawaqit/calendar?mosque=grande-mosquee-de-paris` returns the published calendar and timezone.
- `GET /api/tools/mawaqit/prayer-times?mosque=grande-mosquee-de-paris` returns today's six local times. Optional `date=YYYY-MM-DD` must be in the current year at the mosque.

A mosque can be a slug or a Mawaqit mosque URL. Calendar data is extracted as JSON from the published mosque page without executing JavaScript. Search uses Mawaqit's search API. No upstream key is required. Upstream results may be cached for five minutes; no prayer or night intervals are calculated. The scraper depends on Mawaqit's page format and returns an error if it changes. Response `fetchedAt` is when Kimono handled the request, not an upstream publication timestamp.

Based on [mawaqit-gnome at commit 0e0a730](https://github.com/akramboussanni/mawaqit-gnome/tree/0e0a730b217b463b704f9c72e465e5124b78b5cf). The canonical `/en/{slug}` page URL is used because the reference's `/en/m/{slug}` now redirects.

## Register another API

Add a descriptor to `spec.apiCollection` in `apps/portal/app-definitions/tools/app.json`: unique `id`, `name`, `description`, `source`, `upstreamAuth` (`none` or `api-key`), and `operations`. Each operation supplies a unique `id`, `name`, `description`, `parameters` (name, description, required, example), response description, and example query.

Implement its handlers in `apps/portal/src/lib/tool-apis/` and register them in `apiAdapters` in `adapters.ts`. A handler receives validated query parameters and an optional server-side `upstreamKey`. The adapter must validate semantic constraints and use a fixed upstream host; never fetch a caller-supplied arbitrary URL. Add upstream authentication to the request in the adapter if needed. Caller authentication is already handled by shared dispatch.

Registration produces the app's normal configuration fields, docs page, explorer, and OpenAPI operations. Missing handlers and duplicate registrations fail definition loading; a documented endpoint cannot silently lack an implementation. Access is separately configurable for every operation. New APIs and endpoints default to disabled. `upstreamAuth: api-key` adds an upstream credential field and blocks enabled APIs without that credential.

## Errors and verification

Errors use `{ "error": { "code": "...", "message": "..." } }`. Dispatch rejects unknown/repeated parameters and missing required fields. Statuses: 400 invalid input, 401 invalid/missing caller key, 404 disabled/unknown endpoint or missing mosque, 502 invalid/unavailable upstream, 503 incomplete configuration, 500 unexpected internal failure. Internal exceptions and credentials are not returned. Mawaqit requests have a ten-second timeout, a two-megabyte response cap, and reject redirects.

Run `pnpm --filter @kimono/portal test:tools`, `typecheck`, and `lint`. Tests cover access gates, bearer keys, generated config, OpenAPI secret omission, HTTP dispatch, calendar parsing, timezone boundaries, input validation, upstream failures, administrator key actions, rotation, and revocation. Optional `KIMONO_MAWAQIT_FIXTURE=/absolute/path/to/mosque.html` verifies a downloaded real calendar without making test runs depend on a live service.
