# Arena tournaments — v0.30.0

Administrators create private single-elimination events at `/arena/tournaments`.
Invite an existing member by their registered email. Invitations appear in that
member's event list; this release does not send email or create public sign-up links.
An event supports 2–64 accepted entrants. Up to 20 events can remain open.

## Registration and the draw

An invited member needs the ordinary Arena entitlement and a playable saved deck
to accept. They choose their event alias and acknowledge administrator viewing and
possible streaming of that alias and the public board. Acceptance snapshots the
deck. Editing/deleting the workshop deck later does not change the registered list.
The member can replace their registration or withdraw before the draw.

The organiser starts the event after reviewing accepted entrants. A server-side
Fisher–Yates shuffle uses `crypto.randomInt`; all entrants receive random seeds.
The bracket expands to the next power of two and distributes byes without empty
first-round pairings. Only accepted entrants enter. Registration, seeds, engine
version and deck snapshots then remain fixed. There is no redraw button.

## Playing and advancing

Opening a ready pairing creates one ordinary private PvP table with its assigned
seats and registered deck snapshots. Both players ready up; the first player starts
the table. Invitations, swapping seats, leaving the lobby and cancelling the lobby
are disabled for tournament tables. Existing player eligibility and match quotas
still apply. Each pairing is one game, not a best-of-three series.

Only the verified engine winner advances. Match state, action receipt and bracket
advancement commit in the same database transaction under the event lock. Concurrent
finishes and repeated requests cannot advance twice. The final declares the champion.
Preparing later tables is a separate action, so an absent or newly ineligible next
opponent cannot roll back a completed game.

A draw leaves the pairing unresolved. Open rematch creates a fresh table from the
same snapshots; the previous game remains finished. A pairing allows at most 20
games. An administrator can record a forfeit with an explicit winner and public
reason, or cancel the whole event with a reason. These actions require a current
event revision and are audited. A forfeit closes an unfinished table without
fabricating an engine result. Normal collection and billing records are unchanged.

## Commentary and streaming

The organiser's event page lists open tables. Watch table opens an administrator-only
commentary page with the existing illustrated tabletop, public scoreboard, disclosed
card inspection, public history and a stream view that removes main navigation.
Capture the authenticated browser window using streaming software; this release
does not create a public stream endpoint or connect to a video platform.

The spectator API constructs a neutral server projection. Each player's field is
taken from the opponent's redacted view, so neither opening setup is exposed early.
Both hands are empty arrays; only hand/deck/Prize counts are returned. No deck
snapshots, deck order, Prize identities, private prompts, legal moves, invitation
codes or player controls reach the spectator client. Publicly revealed events and
cards remain available for commentary. Read-only access applies only to tournament
tables, not existing private practice or invitation matches.

Every poll rechecks administrator role. A revoked role or session clears the table
and dialogs on the next read. Spectating does not confer a player seat. The endpoints
retain authentication, private no-store responses, same-origin write checks, rate
limits and strict body/identifier validation. Unknown write outcomes retain the
same request in session storage for retry rather than repeating the action.

## Migration and checks

`019_arena_tournaments.sql` adds event, entrant, bracket and request-receipt tables,
plus nullable tournament links on existing matches. Existing match rules, versions
and private views are preserved. Run the ordinary additive migration during the
standard deployment procedure. No new service or dependency is required.

Unit tests cover bracket sizes/byes and both engine versions' spectator privacy,
including private search decisions. Disposable PostgreSQL tests exercise real HTTP
authorization, snapshots, retries, advancement, rematches, forfeits and cancellation.
Signed-in Chromium/WebKit tests cover invitations, acceptance, the draw, responsive
brackets, commentary inspection, stream view and role revocation. The rare draw
integration case seeds a finished state in the disposable database to exercise the
transactional recorder and rematch path; engine outcome tests remain separate.
