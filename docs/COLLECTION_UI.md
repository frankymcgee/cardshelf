# Compact collecting workspace

CardShelf 0.57.0 puts the card workspace ahead of explanatory content. The overview has compact totals, Cards/Binders/Wishlist shortcuts and a small binder shelf. Binder search and primary catalogue filters remain immediately available. Extra filters, pricing methodology, value history, set progress and secondary binder tools are revealed on demand.

Price totals retain visible AUD/estimate qualifications, coverage, approximate amounts and warnings about included outdated or failed-refresh references. Expanded sections retain source metrics, dates, exclusion counts, graphs and exact observations. Errors and retry controls remain outside collapsed detail content. Collapsing a printing editor preserves its unsaved ownership draft.

Collection binders open on cards, with a separate Value & history view. Prices load on the first visit to that view. Switching views retains the book position, quick-view filters and previously opened price history. Tracking, collection-layout, collection-quick and read-only shared binders use the same book navigator:

- Two pages appear side by side by default, including on phones. A single-page option provides a larger reading/editing view.
- Swiping left/right turns the spread with a paper-turn animation. Previous/Next controls and arrow keys on the focused book remain available.
- Vertical movement scrolls normally. A second touch cancels page-turn detection for pinch zoom; mouse dragging remains available for collection pocket rearrangement.
- A swipe cannot also open a pocket. A subsequent intentional tap still works. Page turns do not change ownership, positions or quantities.
- Navigation stays within the available pages, aligns spread boundaries after a view change, and handles an unpaired final page. Reduced-motion settings suppress the animation.

`tests/browser/collection-ui.spec.mjs` exercises the actual production UI in desktop and phone contexts, including native Chromium touch gestures, keyboard disclosures, saved-view continuity, read-only sharing and unsaved drafts. Existing value-history coverage checks exact prices, gaps, refresh errors and recovery through the new disclosure controls. Run:

```sh
npm run test:collection-ui
npm run test:value-history-ui
npm run test:card-images-ui
npm run test:binder-cover-ui
npm run test:variant-effects-ui
```

The UI changes introduce no API, data-schema or permission changes. Existing ownership and collection-sync confirmation flows remain in place.
