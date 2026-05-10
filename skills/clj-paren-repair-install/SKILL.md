---
name: clj-paren-repair-install
description: Use this skill to install or troubleshoot clj-paren-repair from bhauman/clojure-mcp-light when Clojure delimiter repair reports the command is missing, not on PATH, or unusable. Covers Babashka, bbin, PATH setup, install commands, and verification.
compatibility: Requires shell access; installation may need GitHub network access, git, Babashka, and bbin.
---

# clj-paren-repair Installation

Use this skill when `clj-paren-repair` is missing, not on PATH, or failing before it can repair Clojure delimiters.

`clj-paren-repair` is the on-demand delimiter repair command from [`bhauman/clojure-mcp-light`](https://github.com/bhauman/clojure-mcp-light#clj-paren-repair).

## 1. Check the current state

Before installing, check whether the running agent process can already resolve the command.

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

If the command works in a fresh terminal but not in the agent, restart the agent or the parent process that launched it so PATH changes take effect.

## 2. Install prerequisites

`clj-paren-repair` is installed with `bbin`, which requires Babashka (`bb`). Before running state-changing package manager or install commands, confirm the user wants installation unless they already explicitly requested it.

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

## 3. Ensure bbin binaries are on PATH

Check the bbin binary directory:

```bash
bbin bin
```

Ensure that directory is on the PATH of the running agent process.

Important: updating a shell startup file may not affect an already-running agent session. After changing PATH, restart the agent session or the parent process that launched the agent.

If needed, set `BABASHKA_BBIN_BIN_DIR` to a directory already on PATH before installing tools with bbin, then rerun the install command.

## 4. Install clj-paren-repair

Run the install command from a Unix-like shell or PowerShell. For Windows Command Prompt, prefer launching PowerShell for this step so the quoted `--main-opts` argument is passed exactly.

```bash
bbin install https://github.com/bhauman/clojure-mcp-light.git --tag v0.2.2 --as clj-paren-repair --main-opts '["-m" "clojure-mcp-light.paren-repair"]'
```

## 5. Verify installation

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

The running agent process must be able to resolve `clj-paren-repair` on PATH before automatic repair tooling can use it.

## Troubleshooting notes

- For Codex and other sandboxed bash agents, Babashka (`bb`) 1.12.212 or later is required.
- If installation fails while fetching from GitHub, report the network or Git error instead of repeatedly retrying.
- If PATH was changed during the fix, restart the agent session before rechecking `command -v clj-paren-repair` or equivalent.
- After installation, retry the Clojure edit or run `clj-paren-repair <file>` manually on the affected file.
