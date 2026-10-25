# CMM user guides

Two guides ship with CMM as PDFs:

| Source | PDF | Ships in |
|---|---|---|
| `desktop-guide.md` | `dist/docs/CMM-Desktop-Guide.pdf` | the desktop app (Help › Desktop Guide), Settings › About |
| `server-guide.md` | `dist/docs/CMM-Server-Guide.pdf` | the server tarball (`docs/`), Settings › About |

Build both with `npm run docs:pdf` (offline; uses Playwright's Chromium and the files in this folder only).
`npm run build` builds them too.

The PDF page layout (cover, fonts, page margins) is in `pdf-layout/`.

## Writing conventions

The build (`scripts/build-guides-pdf.ts`) turns Markdown into the PDF with `marked` and a few extras:

- **Front matter.** Each guide starts with a block giving the cover text:

  ```
  ---
  title: CMM Desktop Guide
  subtitle: Install CMM on your computer and keep your memories safe
  ---
  ```

- **Chapters.** Every `#` heading is a chapter. It starts on a new page and is numbered automatically, so
  don't type numbers into headings. `##` headings are sections and appear in the table of contents;
  `###` headings don't.
- **Steps.** Numbered lists (`1.`, `2.`, …) are drawn as step badges. Keep each step short: one action,
  then what you see.
- **Figures.** An image on a line of its own becomes a numbered figure ("Figure 3") with its alt text as
  the caption:

  ```
  ![The setup page asks for a user name and a password.](assets/screens/setup-wizard.png)
  ```

  Screenshots live in `assets/screens/`, diagrams in `assets/diagrams/` (SVG, inlined into the page so
  they use the guide's fonts).
- **Callouts** use the GitHub alert syntax:

  ```
  > [!TIP]
  > You can drag files from your computer straight into a folder.
  ```

  Kinds: `NOTE`, `TIP`, `WARNING`, `DANGER`. Each callout has a label and an icon, so it still reads
  correctly when printed in black and white.
- **Keys and buttons.** Write keys as `<kbd>Ctrl</kbd>`. Write button and menu names in bold, with
  `›` between menu levels: **Settings › Users**.
- **Commands** go in fenced code blocks (`bash` for shell commands, `text` for output).

## Screenshots (`assets/screens/`)

Captured at 1440×900, device scale 2, from a demo workspace.

| File | Shows |
|---|---|
| `setup-wizard.png` | First run: creating the admin account |
| `setup-wizard-server.png` | First run on a server: the setup code, then the admin account |
| `login.png` | The sign-in page |
| `lock-screen.png` | The lock screen after auto-lock |
| `drives-dashboard.png` | The Drives page with storage cards |
| `quick-search.png` | Quick search open with drives and file matches |
| `explorer.png` | The file tree and a Markdown file open |
| `explorer-context-menu.png` | The right-click menu of a file |
| `markdown-viewer.png` | A Markdown file in view mode |
| `markdown-editor.png` | The Markdown editor with its toolbar |
| `code-editor.png` | A code file in the code editor |
| `image-viewer.png` | An image open in the viewer |
| `csv-viewer.png` | A CSV file as a table |
| `media-placeholder.png` | A video file: CMM shows details instead of playing it |
| `memory-overview.png` | The overview page of a memory folder |
| `new-memory-dialog.png` | The New memory dialog with templates |
| `protection-tab.png` | Folder settings › Protection |
| `encryption-step-1-understand.png` | Encryption wizard, step 1: Understand |
| `encryption-step-2-password.png` | Step 2: Confirm password |
| `encryption-step-3-download.png` | Step 3: Download key |
| `encryption-step-4-verify.png` | Step 4: Verify the key file |
| `encryption-step-5-encrypt.png` | Step 5: Encrypt (progress) |
| `encryption-unlock.png` | The unlock panel of a locked encrypted folder |
| `versioning-git-required.png` | The "Git is required" dialog |
| `versioning-history.png` | Version history with a diff |
| `trash.png` | The Trash page |
| `backup-idle.png` | Backup page: the topology with two drives |
| `backup-transfer.png` | Backup page during a transfer |
| `backup-profile-editor.png` | The backup profile editor |
| `settings-users.png` | Settings › Users |
| `settings-security.png` | Settings › Security |
| `settings-storages.png` | Settings › Storages |
| `settings-encryption.png` | Settings › Encryption |
| `settings-about.png` | Settings › About with the Guides panel ("Open Desktop Guide") |

## Diagrams (`assets/diagrams/`)

Hand-made SVGs on a white background, in the app's palette, labelled so they read in greyscale.
Element ids are prefixed with the file name (they are inlined next to each other).

| File | Shows |
|---|---|
| `architecture-desktop.svg` | The desktop app: window, local server, your folders |
| `architecture-server.svg` | The server: browsers on the LAN, optional proxy, the CMM service, storages |
| `encryption-flow.svg` | Generate key, download, verify, encrypt; unlock = key file + password |
| `network-confirm.svg` | When CMM asks for your password: desktop never, LAN once, remote every action |
| `trash-lifecycle.svg` | Delete → Trash → restore, delete permanently, or move to the computer's trash |
| `backup-modes.svg` | Copy, mirror and snapshot |
| `versioning-undo-redo.svg` | Saves become versions; undo and redo add new versions |
