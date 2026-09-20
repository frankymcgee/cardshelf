# Architecture and API

## Stack and boundaries

Nuxt 4 / Vue 3 / TypeScript provide the client interface and a same-origin H3 API.
Nuxt is configured as a client-rendered private application (`ssr: false`); the
Node server still handles authentication and every data mutation. Plain ESM
modules implement database services and shared validation/domain logic. The
worker uses the same service code/image and PostgreSQL job state. The isolated
core functions can be tested with Node without downloading framework packages.

PostgreSQL is the source of truth. The browser holds short-lived page/form state
only. Collection edits are absolute quantities with expected revisions, not
fire-and-forget increments. Browser offline queues, IndexedDB collection storage,
realtime push and optimistic offline replay are not implemented.

## Domain records

- `card_sets`: a provider set in one language, with import completeness metadata.
- `cards`: one provider card in one language (`en:base1-4`, for example).
- `printings`: persistent IDs and portable keys, tied to a card, with provenance.
- `collection_entries`: per-user, per-printing, per-condition quantities and notes.
- `binders` and `binder_slots`: per-user planning layouts; no quantity reservations.
- `app_users`, `sessions`, `auth_attempts`: accounts, hashed sessions, throttling.
- `jobs`, `app_state`: import job lifecycle/leases and worker heartbeat.
- `audit_log`, `schema_migrations`: selected administrative actions and schema history.

Future pricing should reference printings and identify source/currency/as-of time,
not use a card-level price as though every condition/edition shared the same value.
A future physical-copy table can coexist with today's aggregate ownership rows,
but a migration/reconciliation plan will be needed rather than double-counting.

## Authentication and mutation handling

First setup requires the configured bootstrap token and a transactional single-
setup lock. Public registration is absent. An administrator can create ordinary
collector accounts. Sessions use random 256-bit opaque tokens; only token hashes
are stored in PostgreSQL. The browser cookie is HttpOnly, SameSite=Strict, scoped
to `/`, and Secure when the configured browser-visible origin is HTTPS. Session
lifetime is 30 days, without automatic sliding renewal.

State-changing API requests require the exact configured Origin plus
`X-Requested-With: cardshelf`. Requests marked cross-site are rejected. SQL values
are parameterised. Request JSON is size-bounded. A central error translator
returns application errors without returning SQL text/stack traces to the user.
The full-stack behaviour is defined in unexecuted integration tests, not claimed
as audited or production-certified by this package.

## Endpoint summary

All non-public endpoints require the session cookie. Every mutation also requires
the origin and custom request header. JSON request bodies use Content-Type
`application/json`. Ownership and binder routes always scope records to the
session user; caller-supplied `user_id` values are not authoritative.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Database/migration readiness; public |
| GET | `/api/session` | Current user and first-setup status; public |
| POST | `/api/setup` | First administrator with bootstrap token; public, rate-limited |
| POST | `/api/login` | Sign in; public, rate-limited |
| POST | `/api/logout` | Invalidate current server session |
| POST | `/api/password` | Change password and revoke other sessions |
| GET | `/api/dashboard` | Current user's collection counts and imported-design progress |
| GET | `/api/catalogue` | Paginated local search/filter |
| GET | `/api/catalogue/facets` | Imported sets and rarity options |
| GET | `/api/cards/:languageAndId` | Card, printings, and current user's ownership |
| POST | `/api/cards/:languageAndId/printings` | Add a manual printing; administrator only |
| PUT | `/api/collection` | Set one ownership tuple with expected revision |
| GET | `/api/collection/export?format=json` | Export personal ownership; JSON or CSV |
| POST | `/api/collection/import` | Preview/apply documented import schema |
| GET/POST | `/api/binders` | List/create personal binders |
| GET/PATCH/DELETE | `/api/binders/:id` | Read/update/delete personal binder |
| POST | `/api/binders/:id/slots` | Place/clear/swap pockets with expected revision |
| POST | `/api/binders/:id/share` | Enable/rotate/revoke public layout link |
| GET | `/api/shared/:token` | Read-only layout without personal ownership; public |
| GET | `/api/admin/status` | Counts, worker heartbeat and recent jobs; administrator |
| GET | `/api/admin/sets?language=en` | Fetch available provider set index; administrator |
| POST | `/api/admin/imports` | Queue one set import; administrator |
| GET/POST | `/api/admin/users` | List/create accounts; administrator |

Card identifiers in URL paths should be URI-encoded. Printings and binder IDs are
UUIDs. Query page size is capped at 60. Catalogue queries support `q`, `set`,
`language`, `rarity`, `artist`, `dex`, `ownership`, `sort`, `page`, `limit`.
Ownership values are `all`, `owned`, `missing`, `wishlist`; sort is `name` or
`number`. Normal card searches are local database reads and do not call TCGdex.

### Save ownership

```json
{"printing_id":"11111111-1111-4111-8111-111111111111","condition":"NM","quantity":2,"wishlist":false,"notes":"Main binder","revision":0}
```

Revision `0` is used only when that exact printing/condition row does not exist.
An existing row requires its current revision. A stale revision gives HTTP 409.
Setting quantity to zero is not equivalent to deleting the row: revision history,
notes and wishlist state remain available to resolve subsequent edits.

### Move/swap a binder pocket

```json
{"action":"swap","source":0,"target":10,"revision":3}
```

Positions are zero-based over the entire binder. The current implementation moves
a card to an empty target or swaps cards when the target is filled. It does not
discard the target card. Binder row locks and revisions protect simultaneous edits.

## Import lifecycle

An administrator queues `{language,set_id}`. At most one active job per set/language
is allowed. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, keeps a lease
and heartbeat, imports cards into short transactions and reports failures.
Unfinished jobs with stale leases can be retried after five minutes, capped at
three worker claims before being marked failed. Manual re-queue creates a fresh
job. Provider HTTP requests use a fixed host/path grammar, size bounds, timeouts,
limited retries and spacing. No arbitrary URL proxy is exposed.

The worker currently imports each card in a set individually to obtain its full
variant/artist metadata. It does not repeatedly download the entire catalogue on
normal page visits. Queue processing is single-job/single-card at a time in the
initial deployment. Scale workers only after measuring API/provider limits and
confirming acceptable import behaviour.

## Email delivery (v0.20)

Postal settings and delivery administration live under **More → Emails**. The
application submits text email over HTTPS to a configured Postal host. A durable
outbox records event references, retries and delivery metadata; private marketplace
message bodies are not copied into notification email. Password recovery keeps its
separate short-lived queue so link secrets are generated only at delivery time.
Signed provider webhooks update correlated delivery records. Optional marketplace
and membership messages require a member preference; account security messages do
not. See [Postal deployment and operation](POSTAL_EMAIL.md).

## Remaining limitations

There are no native applications, inventory reservations or offline mutation
queues. The PWA service worker caches only an informational fallback page, not
collection API data. Share links are bearer URLs; revocation cannot recall copies
already made by a viewer. Email authentication, TLS and delivery checks do not
constitute a security certification. The operator owns host and DNS configuration,
retention, mailbox reputation and production acceptance testing.
