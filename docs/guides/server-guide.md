---
title: CCM Server Guide
subtitle: Install and run CCM on an offline Ubuntu server
---

# Overview

CCM (Context Memory Manager) is a file manager for LLM memory folders, notes and private files. The server
edition runs on an Ubuntu machine in your home lab or office. People on your network use it from a web browser.
Nothing is installed on their computers.

This guide is for the person who installs and looks after the server. It assumes you are comfortable with a
terminal, `sudo` and editing a text file. You don't need to know how CCM works inside.

## What runs where

![The server edition: browsers on the network reach the CCM service, optionally through a reverse proxy. The service reads and writes the storage folders.](assets/diagrams/architecture-server.svg)

- **The CCM service.** One systemd service called `ccm`, running as the system user `ccm`. It listens on port
  7420 on every network interface by default. It brings its own Node.js runtime, so the server needs no Node,
  npm or other packages.
- **Browsers.** Anyone who can reach the port opens CCM in a browser and signs in with a CCM account. CCM accounts
  are separate from the Linux accounts on the server.
- **An optional reverse proxy.** You can put Caddy (or another proxy) in front of CCM to serve HTTPS. CCM can
  also serve HTTPS itself.
- **Storages.** The folders CCM may show and change. A fresh install creates `/srv/ccm`. You add more with
  `sudo ccm add-storage`. USB drives plugged into the server appear as storages too.

CCM never contacts the internet: there's no telemetry, no update check and nothing is fetched from a CDN. The
installer makes no network calls either, and never runs `apt`, `npm`, `curl` or `wget`. The server can stay
offline for its whole life.

## How the server edition differs from the desktop app

The server and desktop editions share the same interface and features (explorer, editors, memory folders,
protection, encryption, versioning, backups). The differences are about who can reach CCM and how:

| | Desktop app | Server |
|---|---|---|
| Who uses it | The person at the computer | Several people, from browsers on the network |
| Listens on | `127.0.0.1` only, a random port | `0.0.0.0:7420` (configurable) |
| First run | Create the admin account | Create the admin account, after entering a **setup code** |
| Password confirmation | Never | Once per session from the local network; for every protected action from other networks |
| HTTPS | Not needed | Recommended: built-in, your own certificate, or Caddy |
| Storages | Any folder the user can reach | Folders opened to the service with `ccm add-storage` |
| Moving files to the OS trash | Available | Not available (Trash stays inside CCM) |
| Forgotten admin password | Reset CCM | `sudo ccm reset-admin` |
| Logs | A file in the app's data folder | The systemd journal (`journalctl -u ccm`) |

![The explorer: the file tree and a Markdown file open.](assets/screens/explorer.png)

## Where things live

| Path | What it holds |
|---|---|
| `/opt/ccm/<version>` | The program, one folder per installed version |
| `/opt/ccm/current`, `/opt/ccm/previous` | Links to the running version and the one before it |
| `/usr/local/bin/ccm` | The `ccm` admin command (a link into `/opt/ccm/current`) |
| `/etc/ccm/config.json` | The configuration (`0640 root:ccm`) |
| `/etc/ccm/tls/` | The certificate and key made by `ccm gen-cert` |
| `/var/lib/ccm/ccm.db` | The database: users, sessions, storages and access, settings, backup profiles, jobs |
| `/var/lib/ccm/setup-code` | The one-time setup code (deleted when setup is done) |
| `/etc/systemd/system/ccm.service` | The service unit |
| `/etc/systemd/system/ccm.service.d/storage.conf` | The drop-in that opens the storage folders to the service |
| `journalctl -u ccm` | The log |

Your files stay where they are, in the storage folders. CCM keeps its per-folder information (memory settings,
protection, encryption headers) in hidden `.ccm` folders inside them, and its trash in `.ccm-trash` at the top of
each storage.

> [!TIP]
> This guide ships inside the package as `docs/CCM-Server-Guide.pdf`. Once CCM is running, anyone signed in can
> open it from **Settings › About › Open Server Guide**.

![Settings › About shows the version, the mode and the buttons that open the guides.](assets/screens/settings-about.png)

# Requirements

## Operating system

- **Ubuntu Server 22.04 LTS or 24.04 LTS.** Other Debian-family systems with systemd and glibc 2.28 or newer
  should work. The installer refuses anything that isn't Ubuntu or Debian unless you add `--yes`.
- **systemd** must be running. CCM installs as a systemd service; containers without systemd are not supported.
- **x64 (Intel/AMD) or arm64 (ARM)**, with the matching package. Check the machine with:

  ```bash
  uname -m
  ```

  `x86_64` needs the `linux-x64` package, `aarch64` needs the `linux-arm64` package. The installer stops if they
  don't match.

## Memory and disk

| | Size |
|---|---|
| The package (`.tar.gz`) | About 57 MB |
| One installed version in `/opt/ccm` | About 200 MB |
| `/opt/ccm` after an upgrade (current and previous version) | About 400 MB |
| Free space while installing | About 500 MB more (the unpacked package, plus the staging copy) |
| `/var/lib/ccm` | A few MB; it grows slowly with users, jobs and backup history |
| Memory | 2 GB of RAM is a comfortable minimum; that is what the test server had |

The space your files need is on top of this, in the storage folders. Encrypting a folder rewrites its files in
place, and backups need room on the target drive.

## Optional system packages

CCM works without any of these. Each one adds something. On an offline server, copy the `.deb` files over and
install them with `sudo apt install ./<file>.deb`.

| Package | What it adds | Without it |
|---|---|---|
| `acl` (`setfacl`) | `ccm add-storage` grants the `ccm` user access to folders it doesn't own, such as a folder in a home directory | `ccm add-storage` prints `chgrp`/`chmod` commands for you to run instead |
| `udisks2` (`udisksctl`) | USB drives can be mounted, ejected and powered off from inside CCM | Mount drives yourself under `/media` or `/mnt` (see *USB drives on a server*) |
| `git` | Version history for folders | Versioning is switched off, with an explanation in the app |

> [!NOTE]
> Ubuntu Server images don't always include `acl`, and many server installs leave out `udisks2`. Check with
> `command -v setfacl udisksctl git`.

## Network

- A fixed address for the server (a DHCP reservation is enough). People bookmark the URL, and a self-signed
  certificate lists the addresses it was made for.
- Port 7420/tcp reachable from the clients, or 443/tcp if you put Caddy in front.
- A current browser on the client computers: Firefox, Chrome, Edge or Safari.

# Getting the package onto an offline server

CCM ships as one tarball per architecture, with a checksum file next to it:

```text
ccm-server-<version>-linux-x64.tar.gz
ccm-server-<version>-linux-x64.tar.gz.sha256
ccm-server-<version>-linux-arm64.tar.gz
ccm-server-<version>-linux-arm64.tar.gz.sha256
```

You need the pair that matches your server. Copy both files.

## Copy with a USB stick

1. On the computer that has the package, copy the `.tar.gz` and its `.sha256` file to a USB stick.
2. Plug the stick into the server and find its partition:

   ```bash
   lsblk -f
   ```

   Look for the stick's size and file system, for example `sdb1  vfat  MYSTICK`.
3. Mount it and copy the files into your home folder:

   ```bash
   sudo mkdir -p /mnt/stick
   sudo mount /dev/sdb1 /mnt/stick
   cp /mnt/stick/ccm-server-*.tar.gz* ~/
   sudo umount /mnt/stick
   ```

4. Take the stick out.

If the server is reachable over SSH from the computer with the package, `scp` works just as well:

```bash
scp ccm-server-0.1.0-linux-x64.tar.gz ccm-server-0.1.0-linux-x64.tar.gz.sha256 admin@ccm-server:
```

## Check the download

The `.sha256` file holds the SHA-256 checksum of the tarball. Check it before you unpack anything:

1. Go to the folder with both files and run:

   ```bash
   sha256sum -c ccm-server-0.1.0-linux-x64.tar.gz.sha256
   ```

2. You should see:

   ```text
   ccm-server-0.1.0-linux-x64.tar.gz: OK
   ```

> [!WARNING]
> If it says `FAILED`, the file was damaged or changed on the way. Don't install it: copy it again from the
> original.

## Unpack

1. Unpack the tarball and go into the package folder:

   ```bash
   tar -xzf ccm-server-0.1.0-linux-x64.tar.gz
   cd ccm-server-0.1.0-linux-x64
   ```

   Unpacking prints nothing when all is well.
2. Look at what you got:

   ```bash
   ls
   ```

   ```text
   ARCH  BUILD-INFO.txt  README-INSTALL.txt  VERSION  app  bin  deploy  docs  install.sh  node  uninstall.sh
   ```

`README-INSTALL.txt` is a one-page summary of this guide. `deploy/` holds the service unit, the example
configuration, the Caddy example and the USB permission rules. `BUILD-INFO.txt` records how the package was built.

# Installing

## Run the installer

1. From the unpacked package folder, run:

   ```bash
   sudo ./install.sh
   ```

2. Confirm when it asks:

   ```text
   Install CCM 0.1.0 (x64) as the systemd service "ccm"? [y/N] y
   ```

3. Wait for the summary box. The installer starts the service and waits up to 60 seconds for it to answer.

The installer can be run again at any time. Running the same version again repairs an install; running a newer
version upgrades (see *Upgrading and rolling back*).

## Installer options

```bash
sudo ./install.sh [options]
```

| Option | What it does |
|---|---|
| `--port <number>` | The port CCM listens on. Default 7420, or the port already in the config. |
| `--bind <address>` | The address to listen on. Default `0.0.0.0`, every interface. Use `127.0.0.1` behind a proxy on the same machine. |
| `--storage <path>` | A folder CCM may use. Repeat it for more folders. Missing folders are created (`0750 ccm:ccm`). Without any `--storage`, a fresh install creates and uses `/srv/ccm`. |
| `--tls-self-signed` | Make a self-signed certificate and serve HTTPS (the same as `sudo ccm gen-cert`). |
| `--no-start` | Install and enable the service, but don't start it. |
| `--yes`, `-y` | Don't ask for confirmation. Needed when there's no terminal, for example in a script. |
| `--help`, `-h` | Show the options. |

Example: one data folder, HTTPS from the start, no questions:

```bash
sudo ./install.sh --storage /srv/data --tls-self-signed --yes
```

> [!NOTE]
> `--storage` replaces the default `/srv/ccm` only on a **fresh** install. On a server that already has
> `/etc/ccm/config.json`, the config is kept and `--storage` adds folders to it.

## What the installer does

1. **Checks the machine:** it runs as root, systemd is running, the system is Ubuntu or Debian, the architecture
   matches the package, and the bundled Node runtime starts (it needs glibc 2.28 or newer).
2. **Creates the system user `ccm`** (no login shell, home `/var/lib/ccm`) and adds it to the `plugdev` group when
   that group exists.
3. **Copies the program** to `/opt/ccm/<version>`, points `/opt/ccm/current` at it, and links
   `/usr/local/bin/ccm`. It keeps the version you had as `/opt/ccm/previous` and removes anything older.
4. **Writes `/etc/ccm/config.json`** from the example, or keeps the one that is there. It creates `/etc/ccm`
   (`0750 root:ccm`) and `/var/lib/ccm` (`0750 ccm:ccm`).
5. **Opens the storage folders** to the service, the same way `ccm add-storage` does.
6. **Installs the service unit** `/etc/systemd/system/ccm.service` and its storage drop-in.
7. **Sets up USB mounting:** with `udisksctl` present it installs a polkit rule that lets the `ccm` user mount and
   eject drives. Without it, it prints a note.
8. **Makes HTTPS certificates** with `--tls-self-signed`.
9. **Creates the setup code** in `/var/lib/ccm/setup-code` (`0600`, owned by `ccm`).
10. **Enables and starts the service**, waits until it answers, and prints the summary.

## The output

A fresh install without options prints something like this (lines starting with `ccm-install:` come from the
installer; the others come from tools it calls):

```text
ccm-install: created the system user ccm
ccm-install: installed CCM 0.1.0 in /opt/ccm/0.1.0
ccm-install: wrote /etc/ccm/config.json
ccm-install: installed /etc/systemd/system/ccm.service and its storage drop-in
ccm-install: installed the udisks2 polkit rule (CCM can mount and eject USB drives)
Created symlink /etc/systemd/system/multi-user.target.wants/ccm.service → /etc/systemd/system/ccm.service.

+----------------------------------------------------------------------------+
| CCM 0.1.0 is installed and running.                                        |
|                                                                            |
| Open CCM in a browser:                                                     |
|   http://192.168.1.20:7420                                                 |
|                                                                            |
| Setup code (the first page asks for it):                                   |
|   7KQ2-MWXR-9HPT                                                           |
|                                                                            |
| Firewall: if ufw is active, allow the port:                                |
|   sudo ufw allow 7420/tcp                                                  |
|                                                                            |
| Next steps:                                                                |
|   sudo ccm status               check the service                          |
|   sudo ccm add-storage <path>   let CCM use another folder                 |
|   sudo ccm gen-cert             serve HTTPS with a self-signed certificate |
|   sudo ccm logs                 follow the log                             |
+----------------------------------------------------------------------------+
```

The box lists one URL per network interface address. With `--tls-self-signed` the URLs start with `https://`.

Other first lines you may see:

- `ccm-install: USB auto-mount unavailable; mount drives under /media or /mnt manually; see guide §USB` when
  `udisks2` isn't installed. It is repeated under the box. See *USB drives on a server*.
- `ccm-install: created /srv/data` and `Added /srv/data to /etc/ccm/config.json as "data".` for each `--storage`
  folder, followed by `Restart CCM to apply the change: sudo systemctl restart ccm`. You can ignore that last line
  during an install: the installer starts the service itself at the end.

The first line of the box tells you how it went:

| First line | Meaning |
|---|---|
| `CCM 0.1.0 is installed and running.` | All good. |
| `CCM 0.1.0 is installed (not started: sudo systemctl start ccm).` | You used `--no-start`. |
| `CCM 0.1.0 is installed, but it is not answering yet (sudo ccm logs).` | The service didn't answer within 60 seconds. See *Logs and troubleshooting*. |

> [!WARNING]
> The setup code lets whoever has it create the first admin account. Treat it like a password: don't paste it
> into a chat or a ticket, and finish setup soon after installing.

## Check the service

```bash
sudo ccm status
```

```text
CCM:       0.1.0
Installed: 0.1.0
Service:   active
Health:    ok (server mode, version 0.1.0, SQLite 3.53.4, argon2 ok)
Listening: http://0.0.0.0:7420
Open:      http://192.168.1.20:7420
Storages:  1
Setup:     waiting for the setup code (sudo ccm setup-code)
```

`Service` is what systemd reports; `Health` is CCM answering its own health check on this machine. Both must be
good. The service also starts by itself after a reboot.

# First-run setup with the setup code

Until the first admin exists, CCM shows the setup page to every visitor. The setup code makes sure the person who
installed the server, and nobody else on the network, creates that admin.

## Find the setup code

It is in the installer's summary box. To show it again:

```bash
sudo ccm setup-code
```

```text
Setup code: 7KQ2-MWXR-9HPT
Enter it on the first page CCM shows in the browser. It is stored in /var/lib/ccm/setup-code until setup is done.
```

The service also writes a line about it to its log when it starts (`sudo ccm logs`).

If you think someone else has seen the code, replace it:

```bash
sudo ccm setup-code --regenerate
```

The old code stops working straight away.

## Create the admin account

1. On a computer on the same network, open the URL from the summary box, for example `http://192.168.1.20:7420`.
   The setup page opens with a **Server mode** badge.
2. Select **Get started**.
3. Enter the setup code and select **Continue**. Letter case, spaces and dashes don't matter.
4. Choose the **Admin username** (3 to 32 letters, digits, dots, dashes or underscores; stored in lower case).
5. Enter a **Password** and type it again in **Confirm password**. It needs at least 10 characters and can't be the
   username.
6. Select **Continue**.
7. Choose how many idle minutes before a session locks (default 15) and select **Create admin**.
8. When the page says **CCM is ready.**, select **Go to sign in**.

![The setup page asks for the setup code, then the admin account.](assets/screens/setup-wizard-server.png)

As soon as the admin exists, CCM deletes `/var/lib/ccm/setup-code` and the setup page is gone for good. From then
on, `sudo ccm setup-code` only says:

```text
Setup is complete, so there is no setup code. To recover an admin: sudo ccm reset-admin
```

> [!NOTE]
> Wrong setup codes are rate-limited per address: after a few failed tries, that browser has to wait before trying
> again.

## Sign in

Sign in with the account you just made.

![The sign-in page.](assets/screens/login.png)

The first time you upload or download a file, CCM asks for your password once more. That is the password
confirmation described in *Security confirmation behaviour*.

Your next steps:

1. Turn on HTTPS (next chapter) before other people start using CCM.
2. Add the folders CCM should manage (*Storages and permissions*).
3. Create accounts for the other people (*Users and roles*).

# HTTPS

Without HTTPS, passwords, session cookies and files cross the network unencrypted. Anyone who can watch the
network can read them. On anything other than a network you fully control, turn HTTPS on.

There are three ways:

| | Self-signed (`ccm gen-cert`) | Your own certificate | Caddy |
|---|---|---|---|
| Effort | One command | Copy two files, edit the config | Install Caddy, edit two configs |
| Works offline | Yes | Yes | Yes (`tls internal`) |
| Browser warning | Yes, until you accept it | No, if your clients trust the issuer | No, once clients trust Caddy's local authority |
| Port | 7420 | 7420 | 443 |

## Option A: a self-signed certificate with ccm gen-cert

1. Run:

   ```bash
   sudo ccm gen-cert
   ```

   To add a DNS name, such as one your router hands out, use `--host`:

   ```bash
   sudo ccm gen-cert --host ccm.home.lan
   ```

2. Note the fingerprint in the output:

   ```text
   Wrote /etc/ccm/tls/cert.pem and /etc/ccm/tls/key.pem, valid until 2029-01-27.
   Names: ccm-server, ccm-server.local, localhost, 127.0.0.1, ::1, 192.168.1.20
   SHA-256 fingerprint: 4F:1C:9A:...:E2:07
   Browsers warn about a self-signed certificate; compare the fingerprint above before you accept it.
   Restarted CCM (if it was running).
   ```

3. Open `https://192.168.1.20:7420` (note the `https`). The plain `http://` address no longer works.

What `gen-cert` does:

- makes an RSA 2048 / SHA-256 certificate, entirely offline;
- names in it: the host name (or `--host`), `<name>.local` when the name has no dot, `localhost`, and every
  interface address of the server (link-local IPv6 addresses are left out);
- writes `/etc/ccm/tls/cert.pem` (`0644`) and `/etc/ccm/tls/key.pem` (`0640 root:ccm`), in a folder that is
  `0750 root:ccm`;
- sets `"tls"` in `/etc/ccm/config.json` and restarts CCM.

Options: `--host <name>` (default: the server's host name) and `--days <n>`, how long the certificate is valid
(default 825, at most 3650). `--no-restart` leaves the restart to you.

> [!TIP]
> The certificate lists the addresses the server had when you ran `gen-cert`. If the server gets a new address or
> name, run `sudo ccm gen-cert` again and accept the new certificate in each browser.

### The browser warning

Because no certificate authority signed the certificate, every browser warns the first time, for example
"Your connection is not private" (Chrome, Edge), "Warning: Potential Security Risk Ahead" (Firefox) or
"This Connection Is Not Private" (Safari). That is expected. The connection is still encrypted; the browser just
can't tell on its own that the certificate is really your server's.

Check it yourself, once per browser:

1. On the warning page, open the certificate details. In Chrome and Edge, select **Not secure** in the address
   bar, then the certificate. In Firefox, select **Advanced**, then **View Certificate**.
2. Find the **SHA-256** fingerprint.
3. Compare it with the `SHA-256 fingerprint` line `gen-cert` printed. To see it again on the server:

   ```bash
   sudo openssl x509 -in /etc/ccm/tls/cert.pem -noout -fingerprint -sha256
   ```

4. If they match, continue to the site (Chrome: **Advanced › Proceed to …**; Firefox: **Accept the Risk and
   Continue**). If they don't match, stop: something between you and the server is answering in its place.

> [!NOTE]
> Under HTTPS, CCM marks its session cookie `Secure`, so the browser never sends it over plain HTTP.

## Option B: your own certificate

Use this when you have a certificate from your own CA or from your organisation. The file must contain the full
chain (your certificate first, then any intermediates), and the key must not have a passphrase.

1. Copy the files into place with the right owners and modes:

   ```bash
   sudo install -d -m 0750 -o root -g ccm /etc/ccm/tls
   sudo install -m 0644 -o root -g root fullchain.pem /etc/ccm/tls/cert.pem
   sudo install -m 0640 -o root -g ccm privkey.pem /etc/ccm/tls/key.pem
   ```

2. Edit the config:

   ```bash
   sudo nano /etc/ccm/config.json
   ```

3. Set the `tls` entry:

   ```json
   "tls": { "certFile": "/etc/ccm/tls/cert.pem", "keyFile": "/etc/ccm/tls/key.pem" }
   ```

4. Check the file and restart:

   ```bash
   sudo ccm status
   sudo systemctl restart ccm
   ```

   `ccm status` reads the config the same way the service does, so a typo shows up there first.

When the certificate is renewed, copy the new files over the old ones and run `sudo systemctl restart ccm`.

## Option C: Caddy as a reverse proxy

Caddy is a web server that can issue certificates from its own local certificate authority, with no internet
access (`tls internal`). Use it if you want CCM on port 443 or already use Caddy for other services.

### Install Caddy offline

1. On a computer with internet access, download the Caddy `.deb` for your architecture from the Caddy releases
   page on GitHub: `caddy_<version>_linux_amd64.deb` for x64, `caddy_<version>_linux_arm64.deb` for arm64.
2. Copy it to the server, the same way you copied CCM.
3. Install it:

   ```bash
   sudo apt install ./caddy_<version>_linux_amd64.deb
   ```

   `apt` installs a local `.deb` without going online. The leading `./` matters: without it, `apt` looks the name up
   in its package lists.

### Point CCM at Caddy

1. Edit `/etc/ccm/config.json` and set:

   ```json
   "bindHost": "127.0.0.1",
   "trustedProxies": ["127.0.0.1"]
   ```

   Leave `"tls": null`: Caddy does HTTPS, and CCM speaks plain HTTP to Caddy on the same machine.
2. Restart CCM:

   ```bash
   sudo systemctl restart ccm
   ```

`bindHost` `127.0.0.1` means CCM only answers on the server itself, so browsers can't go around Caddy.

> [!WARNING]
> `trustedProxies` **must** contain `127.0.0.1`. Only then does CCM believe the client address Caddy passes in
> `X-Forwarded-For` and the `https` scheme in `X-Forwarded-Proto`. Without it, every visitor looks like the server
> itself (loopback), so people on other networks are treated as local and asked for their password only once per
> session, and the session cookie isn't marked `Secure`.

### Configure Caddy

1. Copy the example that ships with CCM:

   ```bash
   sudo cp /opt/ccm/current/deploy/Caddyfile.example /etc/caddy/Caddyfile
   ```

2. Edit `/etc/caddy/Caddyfile` and replace `ccm.example.lan` with the name or address people will use:

   ```text
   ccm.home.lan {
   	tls internal
   	encode gzip
   	reverse_proxy 127.0.0.1:7420 {
   		flush_interval -1
   	}
   }
   ```

   `flush_interval -1` lets large uploads, long downloads and CCM's live updates (Server-Sent Events) through
   without buffering. Keep it.
3. Reload Caddy:

   ```bash
   sudo systemctl reload caddy
   ```

4. Make sure the clients can resolve the name (a DNS entry on your router, or a line in each client's hosts file),
   then open `https://ccm.home.lan`.

To stop the browser warning, make the clients trust Caddy's local authority: copy
`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` to each client and import it into the system
or browser certificate store.

# Firewall

Ubuntu's firewall, `ufw`, is off by default. Check:

```bash
sudo ufw status
```

If it says `Status: inactive`, there is nothing to do. If it is active, open CCM's port:

```bash
sudo ufw allow 7420/tcp
```

To accept connections only from your local network, name the subnet instead:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 7420 proto tcp
```

With Caddy, open 443 instead (and 80 if you want Caddy to redirect `http://` to `https://`). Port 7420 needs no
rule, because CCM only listens on `127.0.0.1`:

```bash
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
```

If you used `--port`, use that number instead of 7420.

> [!WARNING]
> If you turn `ufw` on for the first time over SSH, allow SSH **before** `sudo ufw enable`, or you lock yourself
> out: `sudo ufw allow OpenSSH`.

# Storages and permissions

A storage is a folder CCM shows on its Drives page. CCM can only reach folders that both the Linux permissions and
the service's sandbox allow. `sudo ccm add-storage` takes care of both.

## Why a command is needed

CCM runs as the user `ccm` in a hardened systemd unit:

- `ProtectSystem=strict`: the whole file system is read-only for the service, except the folders listed with
  `ReadWritePaths=`: `/var/lib/ccm`, the storage folders, and the drive mount points `/media`, `/mnt` and
  `/run/media`.
- `ProtectHome=read-only`: home folders (`/home`, `/root`) are read-only as well, even where file permissions
  would allow writing.
- And, as for any program, the `ccm` user can only open files that its user, its group or an ACL allows.

`ccm add-storage` lists the folder in the drop-in `/etc/systemd/system/ccm.service.d/storage.conf` (which lifts the
read-only rules for it) and grants the `ccm` user access with ACLs.

## Add a storage

1. Make sure the folder exists:

   ```bash
   sudo mkdir -p /srv/projects
   ```

2. Add it, with the name people will see in CCM:

   ```bash
   sudo ccm add-storage /srv/projects --label "Projects"
   ```

3. Check the output:

   ```text
   Granted ccm read and write access to /srv/projects.
   Added /srv/projects to /etc/ccm/config.json as "Projects".
   Updated /etc/systemd/system/ccm.service.d/storage.conf.
   Registered the storage "Projects".
   Restarted CCM (if it was running).
   ```

4. Reload CCM in the browser. The storage appears on the Drives page for admins. Grant other users access in
   **Settings › Storages** or **Settings › Users** (see *Users and roles*).

Without `--label`, the name is the folder's own name. Running `add-storage` again for the same folder is safe: it
re-applies the access and the drop-in, for example after you restored files with other permissions.

`add-storage` refuses:

- relative paths, folders that don't exist, files, and paths with quotes, backslashes or line breaks;
- system folders: `/`, `/home`, `/root`, `/var`, `/srv`, `/opt`, `/media`, `/mnt` and `/tmp` themselves (a folder
  inside them is fine), and anything inside `/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/boot`, `/proc`,
  `/sys`, `/dev` or `/run`;
- CCM's own folders (`/var/lib/ccm`, `/opt/ccm`, `/etc/ccm`), or a folder that contains one of them.

## What it changes on disk

For a folder the `ccm` user doesn't own, `add-storage` runs `setfacl` to add:

- `user:ccm:rwX` on the folder and everything in it;
- the same entry as a **default** ACL, so new files and folders inherit it;
- `user:ccm:--x` on parent folders the service can't pass through (Ubuntu home folders are `0750`). This lets CCM
  walk through `/home/alex` to reach `/home/alex/notes` without being able to list `/home/alex`.

The owner keeps their own access. Check the result with `getfacl`:

```bash
getfacl /home/alex/notes
```

A folder the `ccm` user already owns, such as one created by `install.sh --storage`, keeps its permissions; the
output then says `/srv/data already belongs to ccm.`

The drop-in lists every storage and the drive mount points. The `-` in front of each path lets the service start
even when a folder (such as one on an unplugged disk) is missing:

```text
# Written by `ccm` from storageRoots in /etc/ccm/config.json. Don't edit it by hand:
# use `sudo ccm add-storage <path>` and `sudo ccm remove-storage <path>`.
[Service]
ReadWritePaths=-/srv/ccm
ReadWritePaths=-/home/alex/notes
ReadWritePaths=-/media
ReadWritePaths=-/mnt
ReadWritePaths=-/run/media
```

## Folders in home directories

Home folders need the most care, because of `ProtectHome=read-only` and the `0750` permissions on `/home/<user>`.
Always add them with the command:

```bash
sudo ccm add-storage /home/alex/notes --label "Alex's notes"
```

```text
Granted ccm read and write access to /home/alex/notes (pass-through on /home/alex).
```

Alex can still read and change everything, including the files CCM creates.

> [!WARNING]
> Don't remove `ProtectHome=read-only` from the unit, and don't edit `ccm.service` to make storages work. Use
> `ccm add-storage`: it opens exactly the folders you choose, and the change survives upgrades, which replace
> `ccm.service`.

## Without the acl package

If `setfacl` isn't installed, `add-storage` still adds the folder to the config and the drop-in, but prints the
permission commands for you instead:

```text
setfacl is not installed (package `acl`), so CCM could not grant itself access. Either install it
and run this command again, or give the ccm group access yourself:
  sudo chgrp -R ccm '/home/alex/notes'
  sudo chmod -R g+rwX '/home/alex/notes'
  sudo find '/home/alex/notes' -type d -exec chmod g+s {} +
  sudo chmod o+x '/home/alex'   # lets CCM pass through
```

Either run them, or install `acl` from a copied `.deb` (`sudo apt install ./acl_*.deb`) and run `add-storage`
again. ACLs are the better choice: they don't change the folder's group or open the home folder to every user.

## Remove a storage

```bash
sudo ccm remove-storage /srv/projects
```

```text
Removed /srv/projects from /etc/ccm/config.json.
Updated /etc/systemd/system/ccm.service.d/storage.conf.
Unregistered the storage at /srv/projects. Its files were not touched.
CCM's access to the files stays until you remove it: sudo setfacl -R -x u:ccm,d:u:ccm '/srv/projects'
Restarted CCM (if it was running).
```

The files are never touched. Run the printed `setfacl` command if you also want to take away the `ccm` user's
access. For a home folder, also remove the pass-through entry on the parent: `sudo setfacl -x u:ccm /home/alex`.

## Storages added in the browser

Admins can also add a folder in **Settings › Storages › Internal storages**: enter the **Folder path on the
server** and a **Name**, then select **Add storage**.

![Settings › Storages: internal storages, external drives and who can see new drives.](assets/screens/settings-storages.png)

This registers the folder in CCM, but it can't change the service's sandbox or the folder's permissions. The
storage stays **read-only** (or unreadable, if the `ccm` user has no permission) until you run
`sudo ccm add-storage` for the same path on the server.

Likewise, **Unregister** in the browser removes the storage from CCM but leaves it in `config.json` and the drop-in.
Use `sudo ccm remove-storage` to close it completely.

# USB drives on a server

CCM shows USB drives on its Drives page, can back up to them, and can eject them. On a server there is usually no
desktop to mount drives automatically, so how drives appear depends on whether `udisks2` is installed.

Check:

```bash
command -v udisksctl
```

## With udisks2

When `udisksctl` exists, the installer installs a polkit rule that lets the `ccm` user (which has no login
session) mount, unmount, eject and power off drives:

- `/etc/polkit-1/rules.d/50-ccm-udisks.rules`, for polkit 0.106 and newer (Ubuntu 24.04);
- `/etc/polkit-1/localauthority/50-local.d/50-ccm-udisks.pkla`, for the older polkit 0.105 on Ubuntu 22.04,
  which ignores the JavaScript rule. It is installed when `/etc/polkit-1/localauthority` exists.

What users see:

1. Plug in a stick. It appears on the Drives page; admins see it first (see *Users and roles*).
2. If it isn't mounted yet, select **Mount** next to it. udisks2 mounts it under `/media/ccm/<label>`.
3. Work with the files, or back up to it from the **Backup** page.
4. When done, select the eject icon and confirm **Eject**. CCM unmounts the drive and powers it off; it is then
   safe to unplug.

![The Backup page with two drives connected.](assets/screens/backup-idle.png)

If you install `udisks2` after CCM, run the CCM installer again (the same version is fine) so it adds the polkit
rule.

> [!NOTE]
> The Ubuntu 22.04 `.pkla` rule is part of the package but has had less testing than the 24.04 rule. If **Mount**
> fails on 22.04 with a permission error, check that the `.pkla` file exists and mount manually as described below.

## Without udisks2

This is common on servers. CCM still detects drives that are mounted under `/media` or `/mnt`; you mount them
yourself.

1. Plug in the drive and find its partition:

   ```bash
   lsblk -f
   ```

2. Make a mount point:

   ```bash
   sudo mkdir -p /media/usb
   ```

3. Mount it so the `ccm` user can write to it.

   For FAT32 or exFAT (most sticks), set the owner when mounting:

   ```bash
   sudo mount -o uid=ccm,gid=ccm /dev/sdb1 /media/usb
   ```

   For ext4, mount it and grant access with an ACL:

   ```bash
   sudo mount /dev/sdb1 /media/usb
   sudo setfacl -m u:ccm:rwX /media/usb
   ```

4. Reload CCM in the browser. The drive appears on the Drives page.

To remove it, make sure no copy or backup to it is running in CCM, then:

```bash
sudo umount /media/usb
```

> [!TIP]
> `/media`, `/mnt` and `/run/media` are always writable for the service (they are in the drop-in), so you don't
> need `ccm add-storage` for drives mounted there.

# Security confirmation behaviour

On a server, CCM asks people to confirm their password before sensitive actions. How often depends on where the
browser is.

![When CCM asks for your password: on the desktop never, on the local network once per session, from a remote network for every action.](assets/diagrams/network-confirm.svg)

## Local or remote

CCM looks at the address each request comes from:

- **Loopback** (`127.0.0.1`, `::1`): a browser on the server itself.
- **Local network**: an address inside a subnet of one of the server's own network interfaces. If the server is
  `192.168.1.20/24`, every `192.168.1.x` client is local.
- **Remote**: everything else. That includes other subnets behind a router and most VPN clients, whose addresses
  come from their own range.

CCM decides this for every request, so a laptop that moves from the office network to a VPN changes behaviour in
the same session.

## What gets confirmed

| | Loopback or local network | Remote |
|---|---|---|
| Upload files | Once per session | Every time |
| Download files | Once per session | Every time |
| Delete permanently | Once per session | Every time |
| Manage users | Once per session | Every time |
| Manage storages | Once per session | Every time |

- **Once per session**: the first protected action opens a password prompt. After that, the whole session
  (all of the actions above) goes ahead without asking, until the person signs out or the session ends.
- **Every time**: each action needs the password. The confirmation is valid for that one action on that one item,
  for two minutes, and can't be reused.

Admins choose which actions need confirmation in **Settings › Security › Password confirmation (step-up)**. All
five are on by default. The choice applies to both columns.

> [!WARNING]
> Unticking an action means nobody is asked for it, not even from a remote network. Keep at least **Upload files**
> and **Download files** on if the server can be reached from outside your local network.

![Settings › Security: password, auto-lock, sign-in lockout, password confirmation and active sessions.](assets/screens/settings-security.png)

## Proxies and X-Forwarded-For

Behind a reverse proxy, every request comes from the proxy's address. CCM then looks at `X-Forwarded-For` for the
real client, but **only** when the request comes from an address in `trustedProxies` in `/etc/ccm/config.json`.
Entries can be single addresses (`"127.0.0.1"`) or ranges (`"10.0.0.0/24"`). From any other address, the header is
ignored, so a browser can't pretend to be local by sending it.

The same rule applies to `X-Forwarded-Proto: https`, which tells CCM the browser used HTTPS.

> [!DANGER]
> Only list proxies you run yourself, and never a whole client network or `0.0.0.0/0`. Every address in
> `trustedProxies` can claim any client address, including a local one, and so skip the per-action password.

## Other protections

All of these apply to everyone, local or remote:

- **Auto-lock.** An idle session locks after 15 minutes (set during setup, and in **Settings › Security ›
  Auto-lock**). Unlocking needs the password.
- **Session lifetime.** A session ends after 7 days regardless of activity.
- **Sign-in lockout.** After 5 wrong passwords for one username from one address, sign-in, unlocking and password
  confirmation are blocked for that address and username for 15 minutes. Other devices aren't affected. Both
  numbers are in **Settings › Security › Sign-in lockout**. Locks are kept in memory, so restarting CCM clears
  them.
- **Active sessions.** **Settings › Security › Active sessions** lists your sessions with their browser and
  network (**This machine**, **Local network** or **Remote**). Select **Revoke** to end one.

## Encrypted folders on a server

Encrypted folders work the same on a server as on the desktop, and the server never keeps the key.

![Encryption: generate a key, download it, verify it, encrypt. Unlocking needs the key file and the password.](assets/diagrams/encryption-flow.svg)

- When someone encrypts a folder, CCM gives them a `.ccmkey` key file to download and keep on their own computer
  (or a USB stick, or a password manager). The server keeps no copy.
- To open the folder, they upload the key file from their computer **and** enter their account password. The key
  is then held in the server's memory for that session only.
- The key is wiped when the session locks, when they sign out, when the unlock time runs out (60 minutes by
  default, in **Settings › Encryption**) or when someone selects **Lock all**.
- Decrypted content is never written to the server's disk.

So a stolen server disk, or a backup of it, holds only ciphertext for encrypted folders.

# Users and roles

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything: every storage, users, settings, storages, drives. |
| **Editor** | Read and write on the storages they've been granted. |
| **Viewer** | Read only on the storages they've been granted, even where write is granted. |

The first account, created during setup, is an admin. CCM always keeps at least one enabled admin: it refuses to
delete, disable or demote the last one.

## Add a user

1. Go to **Settings › Users** and select **Add user**.
2. Enter a **Username**, choose the **Role**, and enter a **Temporary password** (at least 10 characters).
3. Select **Create user**.
4. Give the person the URL, their username and the temporary password, in person or another private way.

At their first sign-in, CCM makes them choose their own password.

![Settings › Users: the user list with roles, status and the Manage menu.](assets/screens/settings-users.png)

Each user's **Manage** menu has:

- **Edit role / status**: change the role, or tick **Disabled** to block sign-in and end their sessions now.
- **Storage access**: what they can open (below).
- **Reset password**: set a new temporary password; they choose their own at next sign-in.
- **Delete**: remove the account. Their files stay.

On a remote connection, these changes need the password every time (see *Security confirmation behaviour*).

## Grant access to storages

Editors and viewers see only the storages they've been granted. There are two places to set it:

- per user: **Settings › Users › Manage › Storage access**, one row per storage;
- per storage: **Settings › Storages**, the access button (**Who can open it**) on the storage's row, one row per
  user.

For each pair choose **No access**, **Read**, or **Read and write**. Viewers only ever get read access. Admins can
open every storage and don't appear in these lists.

To keep a storage out of sight while you set it up, use **Hide from everyone but admins** on its row.

## New external drives

A USB drive CCM hasn't seen before is visible **to admins only**. That way a stick someone plugs into the server
isn't shown to every user straight away. An admin then grants access per drive, like any storage.

To change this, go to **Settings › Storages › New drives** and set **New drives are visible to**:

- **Admins only (grant access per drive)**, the default;
- **Everyone (editors can write, viewers can read)**.

CCM remembers each drive's name and access while it is unplugged.

## Lost admin password

If an admin forgets their password, another admin can use **Reset password**. If there is no other admin, use the
CLI on the server (see *Logs and troubleshooting*):

```bash
sudo ccm reset-admin <username>
```

# The CCM CLI reference

The `ccm` command manages the server. It is installed as `/usr/local/bin/ccm` and runs with CCM's own Node
runtime. Run it with `sudo`: most commands change system files, and the rest read the database or the config,
which only root and `ccm` can read.

```bash
sudo ccm help
```

## Commands

| Command | What it does | Needs |
|---|---|---|
| `ccm status [--wait <seconds>]` | Shows the version, installed and previous version, service state, health check, listening address, URLs to open, number of storages and setup state. Exit code 0 when CCM answers its health check, 1 when it doesn't. `--wait` keeps checking for up to that many seconds. | `sudo` (without it, storages and setup show as unknown) |
| `ccm reset-admin` | Lists the admins with their last sign-in. | root or `ccm` |
| `ccm reset-admin <username>` | Gives that admin a random 16-character temporary password, ends their sessions and prints the password. Signing in with it forces a new password. Admins only. | root or `ccm` |
| `ccm add-storage <path> [--label <name>]` | Lets CCM use a folder: checks it, grants ACLs, adds it to `config.json`, rewrites the drop-in, registers it and restarts CCM. Safe to repeat. | root |
| `ccm remove-storage <path>` | Stops using a folder: removes it from the config, the drop-in and CCM, and restarts. Never touches the files. Prints the command to remove the ACL. | root |
| `ccm gen-cert [--host <name>] [--days <n>]` | Makes a self-signed certificate (default host: the server's host name; default 825 days, 1 to 3650), turns HTTPS on in the config and restarts. Prints the SHA-256 fingerprint. | root |
| `ccm setup-code` | Prints the first-run setup code (creating one if missing). After setup it says there is none. | root or `ccm` |
| `ccm setup-code --regenerate` | Replaces the setup code with a new one. | root or `ccm` |
| `ccm logs [journalctl options]` | Follows the service log (`journalctl -u ccm -f`). Extra options go to `journalctl`, for example `-n 200`. Stop with <kbd>Ctrl</kbd>+<kbd>C</kbd>. | `sudo` or a user in the `adm` or `systemd-journal` group |
| `ccm rollback` | Switches `/opt/ccm/current` to the previous version and restarts. Run again to go back. | root |
| `ccm version` | Prints the version. | anyone |
| `ccm help` | Prints the list of commands. Also `ccm --help`, `ccm -h`, or `ccm` alone. | anyone |

`add-storage`, `remove-storage`, `gen-cert` and `rollback` restart CCM when it is running. Add `--no-restart` to
any of them to make the change without restarting; the command then prints
`Restart CCM to apply the change: sudo systemctl restart ccm`.

Two options are mostly for the installer: `ccm setup-code --plain` prints only the code, and `ccm write-dropin`
rewrites the storage drop-in from `config.json`.

## Exit codes and errors

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | The command failed (or, for `status`, CCM didn't answer) |
| 2 | Wrong usage: unknown command or option, a missing path, a number that isn't whole |

Errors start with `ccm:`, for example:

```text
ccm: This needs root. Run: sudo ccm add-storage /srv/projects
ccm: /srv/projects does not exist. Create the folder first.
ccm: There is no previous version to roll back to.
```

## The service itself

The service is managed with the usual systemd commands:

```bash
sudo systemctl status ccm
sudo systemctl restart ccm
sudo systemctl stop ccm
sudo systemctl start ccm
```

## The configuration file

`/etc/ccm/config.json` is plain JSON. `ccm add-storage`, `remove-storage` and `gen-cert` edit it for you; for
anything else, edit it with `sudo nano /etc/ccm/config.json` and run `sudo systemctl restart ccm`.

| Key | Default | Meaning |
|---|---|---|
| `bindHost` | `"0.0.0.0"` | Address to listen on. `0.0.0.0` is every IPv4 interface; `127.0.0.1` only the server itself. |
| `port` | `7420` | Port to listen on. |
| `storageRoots` | `[{ "path": "/srv/ccm", "label": "Server data" }]` | The storage folders and their names. Use `ccm add-storage` rather than editing this. |
| `trustedProxies` | `[]` | Proxy addresses (or ranges) whose `X-Forwarded-For` and `X-Forwarded-Proto` CCM believes. |
| `tls` | `null` | `null` for HTTP, or `{ "certFile": "…", "keyFile": "…" }` for HTTPS. |
| `autoLockMinutes` | `15` | Idle minutes before a session locks, until an admin sets it in the setup wizard or Settings › Security (1 to 1440). |
| `unlockTtlMinutes` | `60` | How long an unlocked encrypted folder stays unlocked, until an admin sets it in Settings › Encryption (1 to 1440). |

CCM refuses to start with an unknown key or a wrong value, and names the problem in the log. `sudo ccm status`
shows the same message, so run it after every edit.

# Backing up CCM itself

There are two separate things to back up:

- **Your files**, in the storage folders. Back them up with CCM's own **Backup** page (to a USB drive) or with
  your usual backup tool.
- **CCM's own state**: `/etc/ccm` and `/var/lib/ccm`. This chapter is about these.

![Backup modes: copy, mirror and snapshot.](assets/diagrams/backup-modes.svg)

## What's in CCM's folders

| Folder | Contents |
|---|---|
| `/etc/ccm` | `config.json`, and `tls/` with the certificate and its **private key** |
| `/var/lib/ccm` | `ccm.db` (with `ccm.db-wal` and `ccm.db-shm` while running): users and password hashes, sessions, storages and access grants, settings, protection and encryption indexes, backup profiles and history, jobs |

Without them, a reinstall still finds your files, but you'd have to recreate users, grants and settings.

## Make a backup

1. Stop CCM so the database is consistent:

   ```bash
   sudo systemctl stop ccm
   ```

2. Archive both folders, keeping owners and modes:

   ```bash
   sudo tar -czf /root/ccm-state-$(date +%F).tar.gz -C / etc/ccm var/lib/ccm
   ```

3. Start CCM again:

   ```bash
   sudo systemctl start ccm
   ```

4. Copy the archive somewhere safe, off the server.

If the `sqlite3` command is installed, you can copy the database without stopping CCM instead:
`sudo sqlite3 /var/lib/ccm/ccm.db ".backup '/root/ccm.db.bak'"`. Copy `/etc/ccm` alongside it.

> [!WARNING]
> The archive holds the TLS private key and every user's password hash. Store it like you'd store the server
> itself: encrypted, or somewhere only admins can reach.

## Restore

1. Install CCM (the same version, or newer) if it isn't installed.
2. Stop it, remove the current database, put the folders back, and start it:

   ```bash
   sudo systemctl stop ccm
   sudo rm -f /var/lib/ccm/ccm.db /var/lib/ccm/ccm.db-wal /var/lib/ccm/ccm.db-shm
   sudo tar -xzf /root/ccm-state-2026-10-25.tar.gz -C /
   sudo ccm write-dropin --no-restart
   sudo systemctl start ccm
   ```

   Removing the old `ccm.db-wal` and `ccm.db-shm` first matters: leftovers from another database must not be
   applied to the restored one.

`write-dropin` rebuilds the storage drop-in from the restored `config.json`. If the storage folders were restored
from elsewhere too, run `sudo ccm add-storage <path>` for each one to re-apply access.

## Encryption keys are never on the server

> [!DANGER]
> CCM never stores encryption key files on the server: not in `/var/lib/ccm`, not in the database, not in the
> storage folders. A backup of the server can't open an encrypted folder, and neither can you, without the
> `.ccmkey` file. **If every copy of a key file is lost, the folder's contents are lost for good.** Nobody, including
> an admin with root on the server, can recover them. Make sure each person who encrypts a folder keeps their key
> file safe, with a second copy away from the server. Never store key files on the server itself.

# Upgrading and rolling back

## How versions are kept

Each version is installed in its own folder, with two links:

```text
/opt/ccm/0.1.0
/opt/ccm/0.1.1
/opt/ccm/current  -> 0.1.1     what the service runs
/opt/ccm/previous -> 0.1.0     what ccm rollback goes back to
```

The installer keeps the current and the previous version and removes anything older.

## Upgrade

1. Copy the new package to the server and check it with `sha256sum -c`, as in *Getting the package onto an offline
   server*.
2. Unpack it and run its installer:

   ```bash
   tar -xzf ccm-server-0.1.1-linux-x64.tar.gz
   cd ccm-server-0.1.1-linux-x64
   sudo ./install.sh
   ```

3. Look for the upgrade line:

   ```text
   ccm-install: upgrading from 0.1.0 to 0.1.1 (roll back with: sudo ccm rollback)
   ```

4. Check the result:

   ```bash
   sudo ccm status
   ```

   `Installed` should read `0.1.1 (previous: 0.1.0)`.

The upgrade keeps `/etc/ccm/config.json`, `/var/lib/ccm` and the storages. It replaces `ccm.service` and rewrites
the storage drop-in from the config. When CCM starts, it updates its database to the new version by itself.

## Roll back

```bash
sudo ccm rollback
```

```text
Switched CCM from 0.1.1 to 0.1.0. Run `sudo ccm rollback` again to go back to 0.1.1.
Restarted CCM (if it was running).
```

Rolling back swaps `current` and `previous`, so running it a second time returns to the newer version.

## Database compatibility

- **Within a minor version** (0.1.x to 0.1.y), database updates only add tables and columns. The previous version
  keeps working on the updated database, so `ccm rollback` is always safe.
- **Across minor versions** (0.1 to 0.2), that isn't promised. Back up CCM's state before upgrading (see *Backing
  up CCM itself*) if you may want to roll back.

To roll back across a minor version, put the old database back as well:

1. Stop CCM:

   ```bash
   sudo systemctl stop ccm
   ```

2. Remove the updated database and restore the backup you made before the upgrade:

   ```bash
   sudo rm -f /var/lib/ccm/ccm.db /var/lib/ccm/ccm.db-wal /var/lib/ccm/ccm.db-shm
   sudo tar -xzf /root/ccm-state-2026-10-25.tar.gz -C /
   ```

3. Switch versions and start:

   ```bash
   sudo ccm rollback --no-restart
   sudo systemctl start ccm
   ```

> [!NOTE]
> Anything people changed in CCM after the backup (new users, grants, settings) is lost with the old database.
> Their files in the storages are not affected.

# Logs and troubleshooting

## Where to look

| Command | Shows |
|---|---|
| `sudo ccm status` | Is the service running, does it answer, on which address, is setup done? |
| `sudo ccm logs` | The log, live. Startup errors are explained here. |
| `sudo journalctl -u ccm -b` | The whole log since the last boot. |
| `sudo journalctl -u ccm --since "1 hour ago"` | The last hour. |
| `sudo systemctl status ccm` | systemd's view, with the last few log lines. |
| `systemd-analyze security ccm` | How tightly the service is sandboxed. |

CCM's own log lines start with `[ccm]`. A healthy start looks like this:

```text
[ccm] database ready in /var/lib/ccm
[ccm] server mode listening on http://0.0.0.0:7420
```

## Admin locked out

If no admin can sign in:

1. List the admins:

   ```bash
   sudo ccm reset-admin
   ```

   ```text
   Admins:
     alex    (last sign-in 2026-10-25T08:14:02.000Z)
   Reset one with: sudo ccm reset-admin <username>
   ```

2. Give one a temporary password:

   ```bash
   sudo ccm reset-admin alex
   ```

   ```text
   Temporary password for alex: hT7mQ2xRk9WbZp4N
   Sign in with it; CCM then asks for a new password. Their other sessions were signed out.
   ```

3. Sign in with it and choose a new password.

If the account is disabled, the command warns you; another admin has to enable it in **Settings › Users**.

If the problem is the **sign-in lockout** (too many wrong passwords), wait for the lock time (15 minutes by
default) or restart CCM, which clears it: `sudo systemctl restart ccm`.

## Common problems

**The browser can't connect.**

- `sudo ccm status`: is `Service` `active` and `Health` `ok`? If not, read `sudo ccm logs`.
- Is the firewall open? `sudo ufw status` (see *Firewall*).
- Is CCM listening on `127.0.0.1` only? `Listening:` in `ccm status` shows it. That is right behind Caddy, but then
  browsers must use Caddy's address.
- Are you using the right scheme? After `ccm gen-cert`, only `https://` works.

**`Health: not reachable … (not listening)` right after a start.** CCM takes a few seconds to start. Use
`sudo ccm status --wait 30`.

**The service keeps restarting and the log says `Invalid CCM config`.** `/etc/ccm/config.json` has a typo, an
unknown key or a wrong value; the message names it. Fix it, check with `sudo ccm status`, then
`sudo systemctl restart ccm`.

**`CCM does not run as root.`** Someone started the server by hand with `sudo`. CCM refuses to run as root,
because files it created would then be unusable by the service. Start it with `sudo systemctl start ccm`.

**`EADDRINUSE` in the log.** Another program uses the port. Find it with `sudo ss -ltnp | grep 7420`, then stop it
or change CCM's `port` in the config (and the firewall rule).

**`failed to start` with an error about `cert.pem` or `key.pem`.** The TLS files in the config are missing or the
`ccm` group can't read the key. Check `ls -l /etc/ccm/tls`: the key must be `-rw-r----- root ccm`. Running
`sudo ccm gen-cert` again makes a fresh pair.

**A storage is read-only, or shows no files.** It was added in the browser, or its permissions changed. Run
`sudo ccm add-storage <path>` for it.

**`setfacl is not installed`.** See *Without the acl package* in *Storages and permissions*.

**`ccm: … is a system folder.`** CCM won't use `/`, `/home`, `/srv` and similar folders themselves. Use a folder
inside them, such as `/srv/ccm` or `/home/alex/notes`.

**A USB drive doesn't appear.** Admins see new drives first; check you're signed in as an admin. Without udisks2,
the drive must be mounted under `/media` or `/mnt` (see *USB drives on a server*). With udisks2, check that the
polkit rule was installed (`ls /etc/polkit-1/rules.d/50-ccm-udisks.rules`).

**People on another network aren't asked for their password every time.** CCM probably sees them as local. If
there's a proxy in front of CCM, `trustedProxies` must list it, or every client looks like the proxy. See
*Proxies and X-Forwarded-For*.

**Everyone is asked for the password on every action, even at the office.** CCM sees them as remote. Either their
subnet isn't one of the server's own (a routed or VPN network), or a proxy forwards addresses CCM doesn't trust.

**The page shows `CCM is starting.`** The service is up but still loading. Wait a few seconds and reload.

**`install.sh` stops with `the bundled Node runtime does not run here`.** The system's glibc is older than 2.28.
Use Ubuntu 22.04 or newer.

**`install.sh` stops with `this package is for arm64, but this machine is x64`.** Use the other package.

**`ccm: This needs root.`** Add `sudo`.

## Asking for help

When you report a problem, include:

```bash
ccm version
sudo ccm status
sudo journalctl -u ccm -b --no-pager | tail -n 100
```

Remove any setup code or temporary password from the output first.

# Uninstalling

The package's `uninstall.sh` removes CCM. It is in the unpacked package folder, and also in
`/opt/ccm/current/uninstall.sh` until it runs.

## Remove the program, keep the data

```bash
sudo ./uninstall.sh
```

```text
Remove the CCM service and program? Config, database and storages are kept. [y/N] y
ccm-uninstall: removed the service, the polkit rule, /usr/local/bin/ccm and /opt/ccm
ccm-uninstall: kept /etc/ccm, /var/lib/ccm, the storages and the ccm user (run with --purge to remove config and data)
```

This stops and disables the service, and removes the unit and its drop-in, the polkit rules, `/usr/local/bin/ccm`
and `/opt/ccm`. Everything else stays. Installing CCM again later picks up the old config and database: users,
grants and settings are all still there.

## Remove everything except your files

```bash
sudo ./uninstall.sh --purge
```

It asks you to type `purge`:

```text
Remove CCM with its config (/etc/ccm), database (/var/lib/ccm) and the ccm user? Storage folders are kept.
Type "purge" to confirm: purge
ccm-uninstall: removed the service, the polkit rule, /usr/local/bin/ccm and /opt/ccm
ccm-uninstall: deleted /etc/ccm
ccm-uninstall: deleted /var/lib/ccm
ccm-uninstall: removed the user ccm
ccm-uninstall: storage folders were not touched:
  /srv/ccm
  /home/alex/notes
```

On top of the plain uninstall, `--purge` deletes `/etc/ccm` (config, certificate and TLS key), `/var/lib/ccm`
(database, setup code) and the `ccm` user and group.

| Option | What it does |
|---|---|
| `--purge` | Also delete `/etc/ccm`, `/var/lib/ccm` and the `ccm` user. |
| `--yes`, `-y` | Don't ask for confirmation (with `--purge`, don't ask for `purge` either). |
| `--help`, `-h` | Show the options. |

> [!NOTE]
> **Storage folders are never deleted, not even with `--purge`.** The script reads the storage list before it
> removes anything, and it keeps `/etc/ccm` or `/var/lib/ccm` if a storage happens to be inside one of them.

## After uninstalling

- Files CCM created in the storages still belong to the old `ccm` user's number. After `--purge`, `ls -l` shows
  that number instead of a name. Give them to someone else if you like, for example
  `sudo chown -R alex: /home/alex/notes`.
- The ACL entries for `ccm` stay on the storage folders. Remove them with
  `sudo setfacl -R -x u:ccm,d:u:ccm <path>` before `--purge` (afterwards, the user name no longer resolves).
- CCM's hidden `.ccm`, `.ccm-trash` and `.ccm-tmp` folders stay in the storages. Files in `.ccm-trash` are files
  people deleted in CCM but didn't empty from the Trash; look through them before you delete that folder.
- Encrypted folders stay encrypted. Decrypt them in CCM before uninstalling if you won't install CCM again, or
  keep the key files: a later CCM install (desktop or server) can open them with the key file and password.
- Undo anything you added for CCM yourself: `ufw` rules (`sudo ufw delete allow 7420/tcp`), Caddy's config, and
  mounts under `/media` or `/mnt`.
