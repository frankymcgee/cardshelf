# Appearance update — verification and publication status

Prepared against frankymcgee/cardshelf main commit:
`dce55bc30f6f1bb0825beb6b0e65052bcfda0e62` (merged pricing/series release).

## Executed locally

- 88 local tests passed: 60 baseline core/configuration tests and 28 new appearance/image tests.
- Full image decoding, resize, metadata removal and deterministic output were exercised using
  the available local sharp 0.34.1. The release pins sharp 0.35.4; that exact version requires CI.
- TypeScript parser checks passed for the local script sources. These are syntax checks,
  not the full Nuxt type checker.
- Vue template tag nesting passed.
- An isolated Chromium style fixture was inspected at desktop and 375 px mobile widths.
  No horizontal overflow at 375 px. Hover animation, reduced-motion suppression, non-intercepting
  overlays and print suppression passed. This was not the compiled app or real mobile hardware.
- The patch applies cleanly to a Git fixture with the exact current preimages of every modified
  file. Preimages were checked against GitHub-returned blob hashes. Unmodified pricing/series
  files are not replaced by this patch.

## Still required after publication

The existing GitHub Actions workflow must install dependencies, run ALL core tests (including
unchanged pricing/generator tests), Nuxt typecheck/build, migrations and all API integration tests.
The new appearance integration suite has not been executed locally: this environment has no
PostgreSQL/Docker server and cannot fetch npm dependencies. Physical browser/device testing,
real uploaded-wallpaper rendering and the Docker upgrade remain deployment checks.

## Publication status

The GitHub write attempt was blocked by the publishing tool. No feature branch or PR was created,
and main remains at the base commit above. The patch is a source update candidate, not a published
or deployed release. It contains no .env, secrets, node_modules, database backups or card artwork.

## Apply in a development checkout

Save the supplied patch in the directory above your checkout. Start with a clean working tree:

```sh
git switch main
git pull --ff-only
git switch -c feature/variant-effects-wallpapers
git apply --check --index ../cardshelf-0.3.0-appearance.patch
```

Only after the check succeeds:

```sh
git apply --index ../cardshelf-0.3.0-appearance.patch
git commit -m "feat: variant effects and binder wallpapers (v0.3.0)"
git push -u origin feature/variant-effects-wallpapers
```

Open a pull request targeting main. Resolve any validation failures before merging. After a green
result and merge, update the existing server checkout using `git pull --ff-only` followed by
`sudo sh scripts/upgrade.sh`. Do not regenerate .env or remove the database volume.
