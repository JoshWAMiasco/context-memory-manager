CMM (Context Memory Manager) server: installing on Ubuntu
=========================================================

This package installs CMM as a systemd service on Ubuntu 22.04 or 24.04 (x64 or arm64; other
Debian-family systems with systemd and glibc 2.28+ should work too). It contains everything CMM
needs, including its own Node.js runtime: the install makes no network calls and never runs apt,
npm, curl or wget, so the server can stay offline.

The full manual is docs/CMM-Server-Guide.pdf (when included in this package).


1. Copy the package to the server
---------------------------------
Copy cmm-server-<version>-linux-<arch>.tar.gz and its .sha256 file (USB stick, scp, ...), then:

    sha256sum -c cmm-server-<version>-linux-<arch>.tar.gz.sha256
    tar -xzf cmm-server-<version>-linux-<arch>.tar.gz
    cd cmm-server-<version>-linux-<arch>

Use the x64 package on Intel/AMD machines and arm64 on ARM (uname -m says x86_64 or aarch64).


2. Install
----------
    sudo ./install.sh

Options:
    --port <number>     port to listen on (default 7420)
    --bind <address>    address to listen on (default 0.0.0.0, every interface)
    --storage <path>    a folder CMM may use; repeat for more. Created if missing. Without any,
                        a fresh install creates and uses /srv/cmm.
    --tls-self-signed   serve HTTPS with a self-signed certificate (see 4)
    --no-start          install and enable the service, but don't start it
    --yes               don't ask for confirmation

Example:  sudo ./install.sh --storage /srv/data --tls-self-signed

The installer creates the system user "cmm", copies the package to /opt/cmm/<version>
(/opt/cmm/current points at it), links /usr/local/bin/cmm, writes /etc/cmm/config.json (kept on
reinstall), installs /etc/systemd/system/cmm.service, starts it and waits until it answers.
At the end it prints a box with the URL(s), the setup code and the next steps.

Where things live:
    /opt/cmm/<version>, /opt/cmm/current    the program (current and previous version)
    /etc/cmm/config.json                    configuration (0640 root:cmm)
    /etc/cmm/tls/                           certificate and key from cmm gen-cert
    /var/lib/cmm/cmm.db                     the database (users, settings, history)
    /var/lib/cmm/setup-code                 the one-time setup code (deleted after setup)
    journalctl -u cmm                       the log


3. First-run setup
------------------
Open the URL from the summary in a browser on your network. CMM asks for the setup code before
anyone can create the first admin; this stops someone else on the network from claiming the
server. Show the code again with:

    sudo cmm setup-code             (sudo cmm setup-code --regenerate makes a new one)

Signed in from the same network, CMM asks for your password once per session before the first
upload or download. From another network (or through a proxy that forwards a remote address) it
asks before every download and upload.


4. HTTPS
--------
Without HTTPS, passwords and files cross the network unencrypted. Three ways to turn it on:

a) Self-signed certificate (simplest, fully offline):

    sudo cmm gen-cert [--host server-name] [--days 825]

   It writes /etc/cmm/tls/cert.pem and key.pem (the key is 0640 root:cmm), with the host name,
   every interface address and localhost as names, switches config.json to TLS and restarts CMM.
   Browsers show a warning ("Your connection is not private") because no authority signed the
   certificate. Compare the SHA-256 fingerprint cmm gen-cert printed with the one the browser
   shows (click the warning, then the certificate), then continue. Session cookies are marked
   Secure under HTTPS.

b) Your own certificate: copy the certificate (full chain) and key to /etc/cmm/tls/ (key 0640
   root:cmm), then add to /etc/cmm/config.json:

    "tls": { "certFile": "/etc/cmm/tls/cert.pem", "keyFile": "/etc/cmm/tls/key.pem" }

   and run: sudo systemctl restart cmm

c) Caddy as a reverse proxy (HTTPS from Caddy's own local authority):
   - Install Caddy offline: download caddy_<version>_linux_<arch>.deb from the Caddy releases
     page on another machine, copy it over, then: sudo apt install ./caddy_<version>_linux_<arch>.deb
     (apt installs a local .deb without the network).
   - In /etc/cmm/config.json set "bindHost": "127.0.0.1" and "trustedProxies": ["127.0.0.1"].
     trustedProxies must list 127.0.0.1: CMM then believes the client address Caddy forwards
     (X-Forwarded-For) and the https scheme (X-Forwarded-Proto). Without it, every visitor
     would look like the server itself. Restart CMM.
   - Use /opt/cmm/current/deploy/Caddyfile.example as /etc/caddy/Caddyfile and reload Caddy.


5. Firewall
-----------
If ufw is active, allow CMM's port (or 443 with Caddy):

    sudo ufw allow 7420/tcp


6. Storages and permissions
---------------------------
CMM runs as the "cmm" user in a hardened unit: the whole file system is read-only for it, except
/var/lib/cmm, the storage folders and the drive mount points (/media, /mnt, /run/media). Home
folders are read-only too (ProtectHome=read-only). To let CMM use a folder, always use:

    sudo cmm add-storage /home/alex/notes --label "Alex's notes"

This checks the folder, grants the cmm user read and write access with ACLs (setfacl, package
"acl"; new files inherit the access), lets it pass through parent folders such as /home/alex,
adds the folder to config.json, writes the systemd drop-in
/etc/systemd/system/cmm.service.d/storage.conf (ReadWritePaths=) and restarts CMM. Without
setfacl it prints the chgrp/chmod commands to run instead.

    sudo cmm remove-storage /home/alex/notes

removes it from CMM and the drop-in. The files are never touched (remove the ACL yourself with
the command it prints). A folder added in Settings > Storages in the browser is registered, but
the hardened unit keeps it read-only until you also run cmm add-storage for it.


7. USB drives (guide §USB)
--------------------------
With udisks2 installed (udisksctl), the installer adds a polkit rule
(/etc/polkit-1/rules.d/50-cmm-udisks.rules, plus a .pkla file on Ubuntu 22.04's older polkit)
that lets the cmm user mount, unmount, eject and power off drives. Plugged-in sticks then appear
in CMM with Mount and Eject.

Without udisks2 (common on servers), mount drives yourself under /media or /mnt, for example:

    sudo mkdir -p /media/usb && sudo mount -o uid=cmm,gid=cmm /dev/sdb1 /media/usb    (FAT/exFAT)
    sudo mount /dev/sdb1 /media/usb && sudo setfacl -m u:cmm:rwX /media/usb           (ext4)

CMM detects drives mounted there. Unmount with sudo umount /media/usb.


8. Upgrading and rolling back
-----------------------------
Unpack the newer package and run its install.sh. It installs /opt/cmm/<new version>, points
/opt/cmm/current at it, keeps the version you had as /opt/cmm/previous and restarts CMM; config,
data and storages stay. CMM updates its database on start. To go back:

    sudo cmm rollback          (run it again to return to the newer version)

Database changes within one minor version (0.1.x to 0.1.y) only add tables and columns, so the
previous version keeps working on the updated database. Across minor versions (0.1 to 0.2), back
up /var/lib/cmm before upgrading if you may want to roll back.


9. The cmm command
------------------
    sudo cmm status                  service state, health, version, URLs, number of storages
    sudo cmm reset-admin [name]      temporary password for an admin (lists admins without a name);
                                     signing in with it forces a new password
    sudo cmm add-storage <path>      let CMM use a folder (see 6)
    sudo cmm remove-storage <path>   stop using a folder (files untouched)
    sudo cmm gen-cert                self-signed certificate and HTTPS (see 4)
    sudo cmm setup-code              show the first-run setup code
    sudo cmm logs                    follow the log (journalctl -u cmm -f)
    cmm version                      the installed version
    sudo cmm rollback                switch to the previous version

Commands that restart CMM accept --no-restart.


10. Backing up CMM itself
-------------------------
Back up /etc/cmm and /var/lib/cmm (stop CMM first, or copy cmm.db with sqlite3 .backup). Your
files are in the storage folders. Encryption key files are never stored on the server.


11. Uninstalling
----------------
    sudo ./uninstall.sh          removes the service, /opt/cmm and /usr/local/bin/cmm;
                                 keeps /etc/cmm, /var/lib/cmm, the storages and the cmm user
    sudo ./uninstall.sh --purge  also deletes /etc/cmm, /var/lib/cmm and the cmm user (asks you
                                 to type "purge")

Storage folders are never deleted, not even with --purge. Files CMM created there stay owned by
the old cmm user id; chown them if you like. (uninstall.sh is also in /opt/cmm/current until it
runs.)


Troubleshooting
---------------
    sudo cmm status                 is it running, does it answer?
    sudo cmm logs                   the log; startup errors are explained there
    systemd-analyze security cmm    how tightly the service is sandboxed

"CMM does not run as root": start it with systemctl, never with sudo node ...
A storage is read-only in CMM: run sudo cmm add-storage <path> for it.
