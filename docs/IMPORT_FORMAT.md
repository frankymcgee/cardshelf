# Ownership import/export format

These are collection records only. A **database backup** is the full-fidelity
backup of binders, accounts, catalogue data, manual printings and ownership.

## JSON

```json
{
  "format": "cardshelf-collection",
  "version": 1,
  "exported_at": "2026-09-16T00:00:00.000Z",
  "entries": [
    {
      "language": "en",
      "card_id": "base1-4",
      "printing": "holo",
      "condition": "NM",
      "quantity": 1,
      "wishlist": false,
      "notes": "Stored in my main binder."
    }
  ]
}
```

The example illustrates identifiers, not a verification of a card's exact
printing coverage. Match against your imported data. Export files can contain
additional descriptive fields (`card_name`, `set_id`, `printing_label`), which
the importer ignores. `card_id` is the provider's ID, not the internal
language-prefixed card key. `printing` is the exact stable printing **key**, not
its display label.

Languages supported by this release: `en`, `ja`. Conditions: `NM`, `LP`, `MP`,
`HP`, `DMG`, `UNKNOWN`. Quantities must be JSON integers from 0 to 9999. Wishlist
must be a JSON boolean. Notes are at most 2,000 characters and are trimmed when
validated. JSON is the recommended lossless export of the stored note content.

## CSV

Required headers, in any order:

```csv
language,card_id,printing,condition,quantity,wishlist,notes
en,base1-4,holo,NM,1,false,"Stored in my main binder."
```

The parser supports quoted commas, quotes escaped as `""`, quoted newlines,
CRLF/LF line endings and a UTF-8 BOM. A UTF-8 file is required. Unknown encodings
are not detected or automatically converted. CSV booleans can be `true`, `false`,
`1` or `0`. Quantities must use ordinary unsigned whole-number notation. Extra
headers are permitted but repeated header names are not.

Exports neutralise spreadsheet formula prefixes by inserting a leading single
quote. Consequently CSV is not byte-for-byte lossless for notes beginning with
formula-like characters; use JSON for that use case.

## Preview and apply

Maximum file size is 2 MB, with at most 5,000 ownership rows. Larger ownership
exports must be split before re-importing, or use a full database restore.

The server matches language + card ID + printing key against its existing local
catalogue. It will **not** create arbitrary global catalogue records from an
untrusted ownership file. Import corresponding sets first and recreate missing
manual printing definitions, or restore a full database backup instead.

The preview lists matched/skipped counts, the first 15 matched rows and up to
100 row errors. Applying revalidates and rematches the original file on the
server. Only matched rows are changed; invalid or unresolved rows are skipped
and counted in the returned result. A repeated card/printing/condition tuple is
reported as a duplicate row, not silently summed.

| Mode | Behaviour |
|---|---|
| Safe merge (`max`) | Keep the greater of existing/imported quantities; combine wishlist with logical OR; keep existing non-empty notes. Repeating the same import does not add copies. |
| Replace matched (`replace`) | Replace quantity, wishlist and notes for each matched tuple. Unmentioned tuples are not deleted. This intentionally overrides current values in matched rows. |

Merges run in a transaction and acquire the same per-user lock used by normal
ownership edits. Entry revisions are incremented when imported values actually
change, so an already-open editor cannot silently overwrite an imported update.

## BinderBuilder migration

A BinderBuilder export is **not** assumed to use these identifiers or this schema.
Direct migration needs an actual exported file and a mapping/exception report.
No connector, scraping fallback or invented private-ID conversion is included.
