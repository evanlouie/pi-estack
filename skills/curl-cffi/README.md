# curl-cffi Agent Skill

A skill for writing, reviewing, and debugging Python code that uses `curl_cffi` and the `curl-cffi` CLI.

## Install

Copy the `curl-cffi` directory into a skills directory such as:

```text
.agents/skills/curl-cffi/
~/.agents/skills/curl-cffi/
```

The folder name must remain `curl-cffi` so it matches the `name` field in `SKILL.md`.

## Contents

- `SKILL.md` — activation metadata and core workflow.
- `references/python-api.md` — Python API patterns.
- `references/impersonation-and-cli.md` — browser impersonation and CLI usage.
- `references/security-and-troubleshooting.md` — SSRF, proxy, TLS, cookie, and packaging gotchas.
- `evals/evals.json` — suggested evaluation prompts.
