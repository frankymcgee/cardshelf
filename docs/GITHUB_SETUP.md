# GitHub publication and deployment

## Current status

The prepared source is version **0.1.1**. Intended repository:
`frankymcgee/cardshelf`, private, default branch `main`. Intended application
origin: `https://tcg.webwire.cloud`.

**No remote repository has been created or populated by this package.** The
connected GitHub integration available during preparation supports publishing
files/commits into an existing accessible repository but has no repository-
creation operation. No server or DNS changes have been made.

## Create the repository for connector-assisted publication

In GitHub, choose **New repository** and select:

| Setting | Value |
|---|---|
| Owner | `frankymcgee` |
| Name | `cardshelf` |
| Visibility | Private |
| Description | Standalone self-hosted trading-card collection and binder planner |
| Add README | Enabled, to create the first commit/branch |
| Add .gitignore | None; the package supplies it |
| Choose a licence | None for now; do not assume a public/open-source licence |

Make the new repository accessible to the connected GitHub app if it is
restricted to selected repositories. Then provide the repository URL in the
conversation. The source can be published on top of the initial README commit,
without force-pushing or replacing any unrelated history.

The README initialization above is for connector-assisted publication. For a
normal command-line import of local Git history, create an empty remote instead
and follow GitHub's separate import instructions to avoid unrelated histories.

## Deployment after publication

Authenticate the server to the private repository, preferably with a read-only
repository deploy key. Do not paste private keys or access tokens into chat or
commit them to source control. Clone the repository, then run from its root:

```sh
sh scripts/configure.sh https://tcg.webwire.cloud
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

The configuration helper creates random database/setup credentials **on that
server**, not in GitHub. It refuses to overwrite an existing `.env`.

Point the hostname to the separate Docker server and arrange inbound HTTP/HTTPS
for the supplied proxy, or use the existing reverse-proxy approach described in
[Deployment](DEPLOYMENT.md). No DNS provider or server-management platform is
assumed here.

Before using real collection data, complete the first-deployment checklist and
backup/restore rehearsal in that document. Do not bypass build/test failures.
The full Nuxt/Docker/PostgreSQL stack has not been validated by preparation alone.

## Sources checked during preparation

- GitHub: Creating a new repository — https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- GitHub: Adding locally hosted code — https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github

Accessed 16 September 2026.
