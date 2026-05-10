# figma-file-reader

Agent Skill for efficiently reading and parsing Figma files, Figma URLs, Figma node links, and Figma REST API JSON.

## Contents

- `SKILL.md` — skill frontmatter and usage instructions.
- `scripts/figma_read.py` — self-contained uv script for URL parsing, API fetching, caching, summaries, node search, and design-token extraction.
- `references/figma-api-notes.md` — Figma API, auth, endpoint, and rate-limit notes.
- `references/output-contracts.md` — compact response templates.
- `evals/` — starter eval prompts and a local sample Figma API JSON fixture.

## Smoke test

From the package root:

```bash
cd skills/figma-file-reader
uv run scripts/figma_read.py parse-url 'https://www.figma.com/design/AbCdEf1234567890/My-App?node-id=12-34'
uv run scripts/figma_read.py summarize evals/files/sample-figma-file.json
uv run scripts/figma_read.py tokens evals/files/sample-figma-file.json
```
