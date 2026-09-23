# Arena lobby and deck workshop — v0.29.2

The lobby uses the existing collector-room and teaching-card artwork, plus each
member's own deck cards, to carry the table presentation into match setup. The most
recent active table takes priority in Continue match; otherwise the newest open
lobby is offered. Open and past tables remain separate. No public matchmaking,
new rules, starter catalogue decks or billing changes are introduced.

## Deck workflow

- Build a draft from local English Pokémon catalogue cards, or copy a saved deck.
  Duplication reads only an owned deck and opens `/arena/decks/new?copy=<id>`.
  The original is unchanged; the ordinary idempotent create endpoint saves the copy.
- Filter by card category, Energy type, imported set, evolution stage and ownership.
  Supported cards are the default. The authoritative compiler runs before pagination
  across the query's entire catalogue, using a database cursor in batches of 200.
  The cursor closes once the next page is established. There is no persistent
  derived support cache or full-catalogue in-memory result. Very broad searches can
  still examine many rows; choose a set/type to narrow them.
- Review pasted text or a CardShelf Arena version 1 JSON export. Text accepts
  `4 Exact Card Name`, `4 en:catalogue-id`, or `4 Card Name | en:catalogue-id`.
  Optional category headings and `#` comments are ignored. External set abbreviations
  are not guessed or converted. Missing sets must be imported separately.
- Every line must resolve to a supported local card before Apply to draft enables.
  Ambiguous names require an explicit matching printing. At most 12 choices are
  shown per line; use the exact ID for another printing. The server rechecks choices
  against the source line. Repeated IDs combine their quantities.
- Applying an import to a nonempty draft requires an explicit replacement checkbox.
  It does not write a saved deck. An incomplete but fully supported list can be saved
  as a draft; existing 60-card/name-copy/Basic/ACE SPEC validation still gates play.
- Unavailable cards in an existing deck remain visible for removal. Saves and match
  snapshots continue to reject unsupported cards. Existing match snapshots are unchanged.
- Leaving an unsaved draft prompts for confirmation. Unknown save outcomes preserve
  the exact request and pause editing until retry. A revision conflict retains local
  edits and asks the member to review the saved deck rather than overwriting it.

Import review is private, authenticated, Arena-gated and read-only. It accepts up to
32,000 text characters / 60 entries / 60 total cards, a 64 KiB HTTP body and a separate
100-per-15-minute review limit. Other platform bodies retain their 16 KiB limit.
It never fetches URLs, trusts imported card effects, grants ownership, changes a
subscription or reveals another member's deck. Catalogue art remains restricted by
the existing compiler URL allowlist. Duplicate/read quotas and revision checks remain.

## Validation

Unit tests cover format/identifier bounds, import parsing, draft replacement, frozen
save retries, server filter parameters and separate-copy intent. Disposable PostgreSQL
integration tests cover filter pagination beyond unsupported rows, fresh support after
catalogue changes, ambiguity, ownership/entitlement isolation, unchanged collection
records, and idempotent copies. Signed-in Chromium/WebKit tests exercise the actual
built lobby and workshop, including import/save/export/duplicate, card inspection,
mobile tabs, deliberate replacement and unsaved navigation.
