---
name: agent-skills
description: >-
  Guidance for creating, maintaining, and optimizing agent skills.
  Use when asked to create/update/maintain/optimize a skill.
---

# Skill Writing

**Always** read through ALL of the following:

- <https://agentskills.io/specification>
- <https://agentskills.io/skill-creation/quickstart>
- <https://agentskills.io/skill-creation/best-practices>
- <https://agentskills.io/skill-creation/optimizing-descriptions>
- <https://agentskills.io/skill-creation/evaluating-skills>
- <https://agentskills.io/skill-creation/using-scripts>

## Self-contained scripts

When you need reusable logic, bundle a script in scripts/ that declares its own dependencies inline. The agent can run the script with a single command — no separate manifest file or install step required.

Several languages support inline dependency declarations:

### Python

PEP 723 defines a standard format for inline script metadata. Declare dependencies in a TOML block inside # /// markers:

```py
# /// script
# dependencies = [
#   "beautifulsoup4",
# ]
# ///

from bs4 import BeautifulSoup

html = '<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>'
print(BeautifulSoup(html, "html.parser").select_one("p.info").get_text())
```

### Bun

Bun auto-installs missing packages at runtime when no node_modules directory is found. Pin versions directly in the import path:

```ts
#!/usr/bin/env bun

import * as cheerio from "cheerio@1.0.0";

const html = `<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>`;
const $ = cheerio.load(html);
console.log($("p.info").text());
```

### Deno

Deno’s npm: and jsr: import specifiers make every script self-contained by default:

```ts
#!/usr/bin/env -S deno run

import * as cheerio from "npm:cheerio@1.0.0";

const html = `<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>`;
const $ = cheerio.load(html);
console.log($("p.info").text());
```

### Ruby

Bundler ships with Ruby since 2.6. Use bundler/inline to declare gems directly in the script:

```rb
require 'bundler/inline'

gemfile do
  source 'https://rubygems.org'
  gem 'nokogiri'
end

html = '<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>'
doc = Nokogiri::HTML(html)
puts doc.at_css('p.info').text
```
