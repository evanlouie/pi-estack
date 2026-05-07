---
name: clj-paren-repair-install
description: Install and troubleshoot clj-paren-repair from bhauman/clojure-mcp-light, including Babashka, bbin, PATH setup, and verification. Use when clj-paren-repair is missing, not on PATH, or Clojure delimiter repair fails because the binary cannot be found.
---

# clj-paren-repair Installation

Use this skill when `clj-paren-repair` is missing or not on PATH.

`clj-paren-repair` is the on-demand delimiter repair command from [`bhauman/clojure-mcp-light`](https://github.com/bhauman/clojure-mcp-light#clj-paren-repair).

## 1. Install prerequisites

`clj-paren-repair` is installed with `bbin`, which requires Babashka (`bb`).

### macOS/Linux with Homebrew

```bash
brew install borkdude/brew/babashka
brew install babashka/brew/bbin
```

### Other platforms

Follow the upstream installation docs:

- Babashka: https://github.com/babashka/babashka#installation
- bbin: https://github.com/babashka/bbin#installation

On Windows, bbin supports Scoop. Restart the terminal or agent process after PATH changes.

## 2. Ensure bbin binaries are on PATH

Check the bbin binary directory:

```bash
bbin bin
```

Ensure that directory is on the PATH of the running pi/agent process.

Important: updating a shell startup file may not affect an already-running pi session. After changing PATH, restart the pi session or the parent process that launched pi.

If needed, set `BABASHKA_BBIN_BIN_DIR` to a directory already on PATH before installing tools with bbin.

## 3. Install clj-paren-repair

```bash
bbin install https://github.com/bhauman/clojure-mcp-light.git --tag v0.2.2 --as clj-paren-repair --main-opts '["-m" "clojure-mcp-light.paren-repair"]'
```

## 4. Verify installation

Unix:

```bash
command -v clj-paren-repair
clj-paren-repair --help
```

Windows PowerShell:

```powershell
Get-Command clj-paren-repair
clj-paren-repair --help
```

Windows Command Prompt:

```bat
where.exe clj-paren-repair
clj-paren-repair --help
```

The running pi/agent process must be able to resolve `clj-paren-repair` on PATH before the automatic repair extension can use it.

## Notes

For Codex and other sandboxed bash agents, Babashka (`bb`) 1.12.212 or later is required.

After installation, retry the Clojure edit or run `clj-paren-repair <file>` manually on the affected file.
