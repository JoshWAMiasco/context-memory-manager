# How to install Git

CMM keeps a folder's history with **Git**, the version-control tool. Git must be installed on the computer that runs CMM: your own computer for the desktop app, or the server for a server install. CMM never downloads anything itself.

After installing, click **Check again** in CMM. Git 2.30 or newer is needed.

## macOS

**With internet:** open Terminal and run:

```sh
xcode-select --install
```

Click **Install** in the window that opens (the Command Line Tools include Git).

**Without internet:** on a computer that has internet, download the Git installer (`git-<version>-intel-universal.pkg`) from the official Git website, copy it over on a USB stick, then double-click it.

## Windows

1. On a computer that has internet, download **Git for Windows** (`Git-<version>-64-bit.exe`) from the official Git for Windows website.
2. Copy the installer over on a USB stick.
3. Run it and keep the default options. CMM finds Git in `C:\Program Files\Git` even if it isn't on `PATH`.

## Ubuntu and Debian

**With internet:**

```sh
sudo apt install git
```

**Without internet:** on a computer with the **same Ubuntu version and architecture** that has internet, download the packages without installing them:

```sh
apt download git git-man liberror-perl
```

Copy the `.deb` files over on a USB stick, then install them:

```sh
sudo dpkg -i git_*.deb git-man_*.deb liberror-perl_*.deb
```

If `dpkg` reports a missing dependency, download that package the same way and include it.

## Checking

Run `git --version` in a terminal. It should print something like `git version 2.43.0`.

For a server install, restart CMM after installing Git if it still isn't found: `sudo systemctl restart cmm`.
