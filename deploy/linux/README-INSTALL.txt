CCM (Context Memory Manager) server: installing on Ubuntu
=========================================================

This package installs CCM as a systemd service on Ubuntu 22.04 or 24.04 (x64 or arm64; other
Debian-family systems with systemd and glibc 2.28+ should work too). It contains everything CCM
needs, including its own Node.js runtime: the install makes no network calls and never runs apt,
npm, curl or wget, so the server can stay offline.

The full manual is docs/CCM-Server-Guide.pdf (when included in this package).


1. Copy the package to the server
---------------------------------
Copy ccm-server-<version>-linux-<arch>.tar.gz and its .sha256 file (USB stick, scp, ...), then:

    sha256sum -c ccm-server-<version>-linux-<arch>.tar.gz.sha256
    tar -xzf ccm-server-<version>-linux-<arch>.tar.gz
    cd ccm-server-<version>-linux-<arch>

Use the x64 package on Intel/AMD machines and arm64 on ARM (uname -m says x86_64 or aarch64).


2. Install
----------
    sudo ./install.sh

Options:
    --port <number>     port to listen on (default 7420)
    --bind <address>    address to listen on (default 0.0.0.0, every interface)
    --storage <path>    a folder CCM may use; repeat for more. Created if missing. Without any,
                        a fresh install creates and uses /srv/ccm.
    --tls-self-signed   serve HTTPS with a self-signed certificate (see 4)
    --no-start          install and enable the service, but don't start it
    --yes               don't ask for confirmation

Example:  sudo ./install.sh --storage /srv/data --tls-self-signed

The installer creates the system user "ccm", copies the package to /opt/ccm/<version>
(/opt/ccm/current points at it), links /usr/local/bin/ccm, writes /etc/ccm/config.json (kept on
reinstall), installs /etc/systemd/system/ccm.service, starts it and waits until it answers.
At the end it prints a box with the URL(s), the setup code and the next steps.

Where things live:
    /opt/ccm/<version>, /opt/ccm/current    the program (current and previous version)
    /etc/ccm/config.json                    configuration (0640 root:ccm)
    /etc/ccm/tls/                           certificate and key from ccm gen-cert
    /var/lib/ccm/ccm.db                     the database (users, settings, history)
    /var/lib/ccm/setup-code                 the one-time setup code (deleted after setup)
    journalctl -u ccm                       the log


3. First-run setup
------------------
Open the URL from the summary in a browser on your network. CCM asks for the setup code before
anyone can create the first admin; this stops someone else on the network from claiming the
server. Show the code again with:

    sudo ccm setup-code             (sudo ccm setup-code --regenerate makes a new one)

Signed in from the same network, CCM asks for your password once per session before the first
upload or download. From another network (or through a proxy that forwards a remote address) it
asks before every download and upload.


4. HTTPS
--------
Without HTTPS, passwords and files cross the network unencrypted. Three ways to turn it on:

a) Self-signed certificate (simplest, fully offline):

    sudo ccm gen-cert [--host server-name] [--days 825]

   It writes /etc/ccm/tls/cert.pem and key.pem (the key is 0640 root:ccm), with the host name,
   every interface address and localhost as names, switches config.json to TLS and restarts CCM.
   Browsers show a warning ("Your connection is not private") because no authority signed the
   certificate. Compare the SHA-256 fingerprint ccm gen-cert printed with the one the browser
   shows (click the warning, then the certificate), then continue. Session cookies are marked
   Secure under HTTPS.

b) Your own certificate: copy the certificate (full chain) and key to /etc/ccm/tls/ (key 0640
   root:ccm), then add to /etc/ccm/config.json:

    "tls": { "certFile": "/etc/ccm/tls/cert.pem", "keyFile": "/etc/ccm/tls/key.pem" }

   and run: sudo systemctl restart ccm

c) Caddy as a reverse proxy (HTTPS from Caddy's own local authority):
   - Install Caddy offline: download caddy_<version>_linux_<arch>.deb from the Caddy releases
     page on another machine, copy it over, then: sudo apt install ./caddy_<version>_linux_<arch>.deb
     (apt installs a local .deb without the network).
   - In /etc/ccm/config.json set "bindHost": "127.0.0.1" and "trustedProxies": ["127.0.0.1"].
     trustedProxies must list 127.0.0.1: CCM then believes the client address Caddy forwards
     (X-Forwarded-For) and the https scheme (X-Forwarded-Proto). Without it, every visitor
     would look like the server itself. Restart CCM.
   - Use /opt/ccm/current/deploy/Caddyfile.example as /etc/caddy/Caddyfile and reload Caddy.


5. Firewall
-----------
If ufw is active, allow CCM's port (or 443 with Caddy):

    sudo ufw allow 7420/tcp


6. Storages and permissions
---------------------------
CCM runs as the "ccm" user in a hardened unit: the whole file system is read-only for it, except
/var/lib/ccm, the storage folders and the drive mount points (/media, /mnt, /run/media). Home
folders are read-only too (ProtectHome=read-only). To let CCM use a folder, always use:

    sudo ccm add-storage /home/alex/notes --label "Alex's notes"

This checks the folder, grants the ccm user read and write access with ACLs (setfacl, package
"acl"; new files inherit the access), lets it pass through parent folders such as /home/alex,
adds the folder to config.json, writes the systemd drop-in
/etc/systemd/system/ccm.service.d/storage.conf (ReadWritePaths=) and restarts CCM. Without
setfacl it prints the chgrp/chmod commands to run instead.

    sudo ccm remove-storage /home/alex/notes

removes it from CCM and the drop-in. The files are never touched (remove the ACL yourself with
the command it prints). A folder added in Settings > Storages in the browser is registered, but
the hardened unit keeps it read-only until you also run ccm add-storage for it.


7. USB drives (guide §USB)
--------------------------
With udisks2 installed (udisksctl), the installer adds a polkit rule
(/etc/polkit-1/rules.d/50-ccm-udisks.rules, plus a .pkla file on Ubuntu 22.04's older polkit)
that lets the ccm user mount, unmount, eject and power off drives. Plugged-in sticks then appear
in CCM with Mount and Eject.

Without udisks2 (common on servers), mount drives yourself under /media or /mnt, for example:

    sudo mkdir -p /media/usb && sudo mount -o uid=ccm,gid=ccm /dev/sdb1 /media/usb    (FAT/exFAT)
    sudo mount /dev/sdb1 /media/usb && sudo setfacl -m u:ccm:rwX /media/usb           (ext4)

CCM detects drives mounted there. Unmount with sudo umount /media/usb.


8. Upgrading and rolling back
-----------------------------
Unpack the newer package and run its install.sh. It installs /opt/ccm/<new version>, points
/opt/ccm/current at it, keeps the version you had as /opt/ccm/previous and restarts CCM; config,
data and storages stay. CCM updates its database on start. To go back:

    sudo ccm rollback          (run it again to return to the newer version)

Database changes within one minor version (0.1.x to 0.1.y) only add tables and columns, so the
previous version keeps working on the updated database. Across minor versions (0.1 to 0.2), back
up /var/lib/ccm before upgrading if you may want to roll back.


9. The ccm command
------------------
    sudo ccm status                  service state, health, version, URLs, number of storages
    sudo ccm reset-admin [name]      temporary password for an admin (lists admins without a name);
                                     signing in with it forces a new password
    sudo ccm add-storage <path>      let CCM use a folder (see 6)
    sudo ccm remove-storage <path>   stop using a folder (files untouched)
    sudo ccm gen-cert                self-signed certificate and HTTPS (see 4)
    sudo ccm setup-code              show the first-run setup code
    sudo ccm logs                    follow the log (journalctl -u ccm -f)
    ccm version                      the installed version
    sudo ccm rollback                switch to the previous version

Commands that restart CCM accept --no-restart.


10. Backing up CCM itself
-------------------------
Back up /etc/ccm and /var/lib/ccm (stop CCM first, or copy ccm.db with sqlite3 .backup). Your
files are in the storage folders. Encryption key files are never stored on the server.


11. Uninstalling
----------------
    sudo ./uninstall.sh          removes the service, /opt/ccm and /usr/local/bin/ccm;
                                 keeps /etc/ccm, /var/lib/ccm, the storages and the ccm user
    sudo ./uninstall.sh --purge  also deletes /etc/ccm, /var/lib/ccm and the ccm user (asks you
                                 to type "purge")

Storage folders are never deleted, not even with --purge. Files CCM created there stay owned by
the old ccm user id; chown them if you like. (uninstall.sh is also in /opt/ccm/current until it
runs.)


Troubleshooting
---------------
    sudo ccm status                 is it running, does it answer?
    sudo ccm logs                   the log; startup errors are explained there
    systemd-analyze security ccm    how tightly the service is sandboxed

"CCM does not run as root": start it with systemctl, never with sudo node ...
A storage is read-only in CCM: run sudo ccm add-storage <path> for it.
