<p align="center">
  <img src="public/icons/cmm/logo.svg" alt="CMM logo: a brain wired into a hard drive" width="120" height="120">
</p>

<h1 align="center">CMM — Context Memory Manager</h1>

<p align="center">
  A self-hosted file manager for the memory folders, prompts and private files of your LLM tools.<br>
  Encrypted, versioned and backed up on your own drives. Runs fully offline.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-4cc9f0"></a>
  <img alt="Desktop: macOS, Windows, Linux" src="https://img.shields.io/badge/desktop-macOS%20%7C%20Windows%20%7C%20Linux-0d2233">
  <img alt="Server: Ubuntu" src="https://img.shields.io/badge/server-Ubuntu%2022.04%2B-0d2233">
  <img alt="Network: offline" src="https://img.shields.io/badge/network-offline-307e9b">
</p>

![The Drives page: every storage and USB drive as a card, with free space.](docs/guides/assets/screens/drives-dashboard.png)

AI agents and chat tools keep their memory in plain folders: personas, project knowledge, scratchpads, notes,
datasets. CMM gives those folders a proper home. Browse and edit them in one app, mark folders as memories, lock or
encrypt the sensitive ones, keep a history of every change, and back everything up to a USB stick or external drive.
Nothing leaves your machine: there is no account, no cloud and no telemetry.

CMM runs two ways:

- **Desktop app** for macOS, Windows and Linux (Electron). Your files stay where they are on your computer.
- **Server** on an Ubuntu machine on your network (systemd service), opened from any browser on the LAN, with user
  accounts and HTTPS.

## Features

### Explorer and editors

A file tree and a file pane, side by side. Markdown opens formatted and edits in a rich editor or as source; code opens
with syntax colours in a code editor; images, PDFs and CSV/TSV tables have their own viewers. Drag and drop, copy and
paste across drives, upload, download as zip, and a trash you can restore from. Hide the tree (<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>\\</kbd>)
to give the editor the whole window.

![The explorer with a Markdown file open.](docs/guides/assets/screens/explorer.png)

| Markdown editor | Code editor |
|---|---|
| ![The rich Markdown editor with its toolbar.](docs/guides/assets/screens/markdown-editor.png) | ![A TypeScript file in the code editor.](docs/guides/assets/screens/code-editor.png) |
| **CSV and TSV tables** | **Images** |
| ![A CSV file as a sortable, filterable table.](docs/guides/assets/screens/csv-viewer.png) | ![An image in the viewer.](docs/guides/assets/screens/image-viewer.png) |

### Quick search

Press <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> to switch drives, jump to a page, or find any file or folder by name.

![Quick search finding folders by name in the open drive.](docs/guides/assets/screens/quick-search.png)

### Memory folders

Turn any folder into a **memory** with a name, a colour and a description, or start one from a template (LLM persona,
project knowledge, agent scratchpad). Each memory gets an overview with its size, recent files and quick actions, a card
of its own on the Drives page (memories on plugged-in drives too, so a drive from another computer shows what it holds),
and its own view whose file tree starts at the memory.
Folders can be made **view-only** or **locked**, so an agent or a slip of the mouse can't change them.

| Memory overview | Protection |
|---|---|
| ![The overview page of a memory folder.](docs/guides/assets/screens/memory-overview.png) | ![The protection settings of a folder.](docs/guides/assets/screens/protection-tab.png) |

### Encryption

Encrypt a folder with AES-256-GCM. Its key lives in a key file that you keep, for example on a USB stick. Files stay
encrypted on disk and in every backup; unlock the folder with its key file to read and edit them inside CMM, and it
locks again on its own.

| Encryption wizard | Unlocking a folder |
|---|---|
| ![The encryption wizard.](docs/guides/assets/screens/encryption-step-2-password.png) | ![The unlock panel of an encrypted folder.](docs/guides/assets/screens/encryption-unlock.png) |

### Version history

Turn on versioning for a folder and CMM keeps a Git history of it: every save is a version you can compare and restore,
with undo and redo, named snapshots, and nothing to learn about Git.

![The history of a file with a diff.](docs/guides/assets/screens/versioning-history.png)

### Backups

Back up any folder to another drive: copy, mirror, or dated snapshots. Select folders and memories in the tree (or open
a folder's settings) to back them up into a new memory on a drive, with their names, icons, encryption and history; plug
that drive into another computer with CMM and copy them onto it the same way. Profiles can run as soon as a drive is
plugged in, interrupted backups resume where they stopped, and a live picture shows your computer, its drives and every
running transfer.

| Backup topology | A running transfer |
|---|---|
| ![The backup page with the computer and its drives.](docs/guides/assets/screens/backup-idle.png) | ![A backup in progress.](docs/guides/assets/screens/backup-transfer.png) |

### Terminals

Open a terminal in any folder or memory to run commands, Git, or command-line agents such as Claude Code. Terminals
dock along the bottom of the window like chat windows: open several, minimize, resize, and pick up where you left off
after a reload. Admins only; on a server they stay off until an admin turns them on.

### Users and security

Admin, editor and viewer accounts with per-storage access, sign-in lockout, auto-lock, a password check before
sensitive actions, and HTTPS on the server. Drives (internal folders, external disks and USB sticks) appear and
disappear live, and can be ejected from CMM. A drive the computer can only read (such as an NTFS drive on a Mac) is shown
as read-only, with the reason, instead of failing when you write to it. The version shows on the sign-in page and the
Drives page.

| Users | Security |
|---|---|
| ![Settings › Users.](docs/guides/assets/screens/settings-users.png) | ![Settings › Security.](docs/guides/assets/screens/settings-security.png) |

## Guides

Two illustrated guides cover installing and using CMM, written for non-technical users:

- [Desktop Guide](docs/guides/desktop-guide.md): install the app, storages, memories, encryption, versions, backups.
- [Server Guide](docs/guides/server-guide.md): install on Ubuntu, HTTPS, users, drives, updates and troubleshooting.

`npm run docs:pdf` builds both as PDFs (`dist/docs/`); the desktop app and the server package include them.

## Getting started

Requires **Node.js 22** (see `.nvmrc`).

```bash
npm install
npx playwright install chromium   # once: used to build the PDF guides and the app icons
```

### Run from source

```bash
npm run dev      # http://127.0.0.1:7420, data in .cmm-dev-data/
```

The first visit opens the setup wizard. In this (server) mode it asks for a one-time setup code, which the terminal
prints (`[cmm] first-run setup code: …`) and `.cmm-dev-data/setup-code` holds. To browse a folder, list it in
`.cmm-dev-data/config.json` and restart:

```json
{ "storageRoots": [{ "path": "/absolute/path/to/a/folder", "label": "My files" }] }
```

Plugged-in USB drives show up on their own.

### Build

```bash
npm run build    # the server in dist/app, the desktop main process in dist/electron, the PDF guides in dist/docs
npm start        # runs dist/app/entry.js
```

### Installing on your own Mac

```bash
npm run install:desktop              # build, sign, quit CMM, install in /Applications, open it
npm run install:desktop -- --rollback   # go back to the version installed before
```

It refuses while CMM is running a backup or another job (`--force` to quit anyway), keeps the previous version for
`--rollback`, and leaves CMM's data alone (each version migrates it on start). `--skip-build` installs the last build.

Put a code signing identity from your keychain (`security find-identity -v -p codesigning`) in `.cmm-local.json`, which
is not committed:

```json
{ "signingIdentity": "Apple Development: Your Name (TEAMID)" }
```

With it, macOS keeps CMM's access to Documents, Desktop and Downloads across updates. Without it the app is ad-hoc
signed, a new identity for macOS each build, and it asks for those permissions again after every update.

### Desktop installers

```bash
npm run build:desktop   # dmg on macOS, nsis on Windows, AppImage + deb on Linux, in dist/desktop/
```

Build each installer on its own operating system and architecture: the native modules (`better-sqlite3`,
`@node-rs/argon2`) are installed for the machine that runs `npm install`. Options after `--`: `--dir` (unpacked app
only), `--skip-build`, `--arch x64`, `--targets AppImage`. Without a signing certificate the apps are unsigned (ad-hoc
on macOS).

### Server package for Ubuntu

```bash
npm run package:server -- --arch x64     # or arm64
```

Build it on Linux with C++ build tools installed (`sudo apt install build-essential python3`): `npm install` compiles
the terminal module there. This makes an offline tarball with its own Node.js runtime and `install.sh`, which sets CMM
up as a hardened systemd service with the `cmm` admin command. The [Server Guide](docs/guides/server-guide.md) walks
through the install.

### Other commands

| Command | What it does |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run check:offline` | Builds and fails if the output contains a fetchable external URL |
| `npm run docs:pdf` | Builds the PDF guides from `docs/guides/` |
| `npm run icons:app` | Regenerates the desktop app icons from `public/icons/cmm/logo.svg` |
| `npm run db:generate` | Creates a database migration after a schema change |

## Built with

Next.js 16 and React 19, TanStack Query, Tailwind CSS 4, SQLite with Drizzle, Tiptap and CodeMirror, pdf.js,
xterm.js and node-pty, simple-git, Electron 45 and electron-builder. Fonts: Oxanium, Martian Mono and Inter (SIL Open Font License). Every
dependency's license is listed in the app under **Settings › About**.

## Contributing

CMM is shared as is, and this repository does not take contributions: pull requests and feature requests won't be
reviewed or merged. If you want to change something or fix a bug, **fork it** and make it your own version; the MIT
license lets you use, change and publish your fork freely.

## License

[MIT](LICENSE) © 2026 Joshua Miasco
