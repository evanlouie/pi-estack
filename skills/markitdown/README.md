# markitdown Agent Skill

Portable Agent Skill for converting documents and trusted public URLs to Markdown with Microsoft MarkItDown.

## Install

Copy the `markitdown/` directory into a skills directory such as:

```bash
mkdir -p .agents/skills
cp -R markitdown .agents/skills/markitdown
```

The required skill file is `SKILL.md`. The helper script is self-contained and runs with uv:

```bash
uv run .agents/skills/markitdown/scripts/convert_to_markdown.py ./file.pdf --output-dir ./converted --json
```

## Contents

```text
markitdown/
├── SKILL.md
├── README.md
├── scripts/
│   ├── convert_to_markdown.py
│   └── convert_to_markdown.py.lock
├── references/
│   └── markitdown-reference.md
└── evals/
    └── evals.json
```
