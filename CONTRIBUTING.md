# Contributing

Thanks for your interest in CMM. Contributions are welcome: bug fixes, new features, documentation, translations of
the guides, and better screenshots all help.

## Ways to help

- **Report a bug**: open an [issue](https://github.com/JoshWAMiasco/context-memory-manager/issues/new/choose) with
  what you did, what you expected, what happened, and your platform (desktop on macOS, Windows or Linux, or the Ubuntu
  server) and CMM version (on the sign-in page and the Drives page).
- **Suggest a feature**: open an issue describing the problem it solves before writing code, so we can agree on the
  approach first.
- **Fix something**: issues labelled `good first issue` and `help wanted` are a good place to start. Comment on the
  issue to say you're working on it.
- **Improve the docs**: the [Desktop Guide](docs/guides/desktop-guide.md) and [Server Guide](docs/guides/server-guide.md)
  are written for non-technical users; clearer steps and fresh screenshots are always useful.

Small fixes (typos, obvious bugs) can go straight to a pull request. For anything larger, open an issue first.

## Security issues

Please don't report security problems in a public issue. Use
[Report a vulnerability](https://github.com/JoshWAMiasco/context-memory-manager/security/advisories/new) on the
Security tab instead, so it can be fixed before it's public.

## Setting up

Requires **Node.js 22** (see `.nvmrc`).

```bash
git clone https://github.com/<your-username>/context-memory-manager.git   # your fork
cd context-memory-manager
npm install
npx playwright install chromium   # once: used to build the PDF guides and the app icons
npm run dev                       # http://127.0.0.1:7420, data in .cmm-dev-data/
```

The first visit opens the setup wizard; the terminal prints the one-time setup code. See
[Getting started](README.md#getting-started) for listing folders to browse, building the desktop app and the server
package.

## Where things are

| Folder                                   | What's in it                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `app/`                                   | Next.js routes: pages under `(app)` and `(auth)`, the HTTP API under `api/`                                |
| `components/`                            | React components, grouped by feature (`explorer`, `editor`, `backup`, `encryption`, `memory`…)             |
| `server/`                                | Everything that runs on the server: auth, crypto, database, backups, jobs, memory discovery, the admin CLI |
| `lib/`                                   | Code shared by the browser and the server: API types, file kinds, editor helpers                           |
| `electron/`                              | The desktop app's main process, preload and menus                                                          |
| `hooks/`, `utilities/`, `configuration/` | React hooks, small helpers, theme and navigation settings                                                  |
| `styles/`                                | Tailwind and the design tokens (`design-tokens.css`)                                                       |
| `docs/guides/`                           | The user guides and their screenshots                                                                      |
| `deploy/linux/`                          | The systemd service and install files for the Ubuntu server                                                |
| `site/`                                  | The website, published to GitHub Pages on every push to `main`                                             |
| `scripts/`                               | Build, packaging and check scripts run by `npm run …`                                                      |

## Things to keep in mind

- **CMM runs fully offline.** Don't add code that calls the network: no CDNs, web fonts, analytics or update checks.
  `npm run check:offline` builds the app and fails if it finds a fetchable external URL. A URL that is never fetched
  (a link in the About page, say) goes in `scripts/offline-allowlist.json` with a reason.
- **It runs two ways.** Changes should work on the desktop app (Electron) and on the server (several users, admin,
  editor and viewer roles). Check that a viewer can't do what only an editor or admin should.
- **Be careful with security-sensitive code**: `server/auth`, `server/crypto`, encryption, terminals and anything that
  touches paths on disk. Explain your reasoning in the pull request.
- **Database changes**: edit `server/db/schema.ts`, then run `npm run db:generate` to create the migration in
  `server/db/migrations/` and commit it.
- **New dependencies**: keep them few, and only with licenses compatible with MIT. Every dependency is listed in the
  app under Settings › About (generated by `scripts/gen-licenses.ts`).
- **User-facing changes**: update the README and the guides in `docs/guides/` if they describe what you changed, and
  replace any screenshot that no longer matches.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run check:offline
npx prettier --check <the files you changed>
```

There is no automated test suite yet, so in the pull request describe how you tested the change: which mode (desktop,
server or both), which platform, and the steps you followed. Screenshots or a short recording help a lot for UI
changes.

## Pull requests

1. Fork the repository and create a branch from `main` (`fix/eject-protected-folder`, `feature/tag-search`…).
2. Keep each pull request to one change. Several small pull requests are reviewed faster than one large one.
3. Write commit messages like the existing ones: a short summary line (`Fix ejecting a drive that has locked
folders`), then a body that explains what changed and why.
4. Open the pull request against `main` and fill in the template. Link the issue it closes (`Closes #12`).
5. A maintainer will review it. Expect questions and requested changes; push them to the same branch.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT license](LICENSE).
