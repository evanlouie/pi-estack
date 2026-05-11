# web-fetch-markdown

Agent Skill for efficient public web fetching and Markdown conversion using
`curl_cffi` and `MarkItDown`.

## Install

Copy this directory to a skills location such as:

```text
.agents/skills/web-fetch-markdown
~/.agents/skills/web-fetch-markdown
```

The script is self-contained for `uv`:

```bash
uv run scripts/fetch_markdown.py --help
```

For reproducible dependency resolution in a networked development environment,
run:

```bash
uv lock --script scripts/fetch_markdown.py
```

## Contents

```text
web-fetch-markdown/
├── SKILL.md
├── README.md
├── scripts/
│   └── fetch_markdown.py
├── references/
│   └── fetching-guidelines.md
└── evals/
    └── evals.json
```
