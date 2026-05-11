# Description and Evaluation Playbook

Use this when writing trigger descriptions, trigger evals, output-quality evals,
and iteration plans.

## Description principles

The `description` field carries the activation burden because agents initially
see only `name` and `description`. A good description is concise, imperative,
and intent-focused.

Use this pattern:

```yaml
description: >
  Use this skill when the user asks to [task intent], including [adjacent intents],
  [domains/files/tools], or [implicit wording]. It helps by [core actions].
```

Checklist:

- Starts with “Use this skill when...” or equivalent imperative phrasing
- Names user intents, not just implementation details
- Includes important domain terms, file types, tools, or artifacts
- Covers implicit phrasing where users may not name the domain
- States boundaries if near-miss false triggers are likely
- Stays under 1024 characters

## Trigger evals

Store trigger eval queries in `evals/eval_queries.json`:

```json
[
  {
    "query": "Create a skill from this billing API runbook",
    "should_trigger": true
  },
  {
    "query": "Explain how YAML frontmatter works generally",
    "should_trigger": false
  }
]
```

Aim for about 20 queries when optimizing descriptions: roughly 8-10
should-trigger and 8-10 should-not-trigger. Smaller sets are acceptable for
early drafts.

### Should-trigger query variety

Include variations across:

- Formal and casual phrasing
- Typos, abbreviations, and incomplete requests
- Explicit domain mentions and implicit intent
- Terse prompts and context-heavy prompts
- Single-step and multi-step tasks
- File paths, artifact names, and user-specific context

The most valuable positive cases are ones where the skill should help but the
user does not use the exact skill keywords.

### Should-not-trigger query variety

Use near misses, not obvious unrelated prompts. Negative queries should share
words or concepts with the skill but require a different capability.

For a skill-writing skill, strong negative examples include:

- “Write a prompt for an assistant persona” — prompt engineering, not Agent
  Skills.
- “Create a GitHub Actions workflow” — workflow file creation, not Agent Skills.
- “Use the data-cleanup skill on this CSV” — using an existing skill, not
  authoring one.
- “Implement an agent client that loads skills” — client implementation, not
  skill authoring.

## Trigger optimization loop

1. Split queries into train and validation sets, preserving positive/negative
   balance.
2. Run each query multiple times if the client is nondeterministic.
3. Compute trigger rate for each query.
4. Revise the description using train-set failures only.
5. Select the best description by validation pass rate.
6. Sanity-check with fresh queries that were never used for optimization.

If should-trigger queries fail, broaden the description by intent category. If
should-not-trigger queries false-trigger, add boundaries. Avoid copying exact
failed-query keywords into the description unless they represent a genuine
category.

## Output-quality evals

Store output evals in `evals/evals.json`:

```json
{
  "skill_name": "skill-creator",
  "evals": [
    {
      "id": "create-basic-skill",
      "prompt": "Create an Agent Skill for generating weekly engineering status reports.",
      "expected_output": "A complete skill directory with valid SKILL.md, a concise description, and relevant workflow instructions.",
      "assertions": [
        "The skill has a SKILL.md with valid frontmatter",
        "The description states when to use the skill",
        "The body contains a step-by-step workflow",
        "The package avoids unnecessary scripts"
      ]
    }
  ]
}
```

Good assertions are observable and specific:

- “The output includes a valid JSON file”
- “The report has at least three recommendations”
- “The script exits nonzero when required flags are missing”

Weak assertions are vague or brittle:

- “The output is good”
- “The response uses exactly this phrase”

## Baseline comparison

For meaningful output evals, compare runs with the skill against runs without
it, or against a previous skill version. Save outputs separately, grade
assertions, then compute deltas in pass rate, time, and token use when
available.

## Iteration signals

Use three kinds of evidence:

- Failed assertions: concrete missing behavior
- Human feedback: broader usability or quality issues
- Execution transcripts: where the agent wasted time, ignored a rule, or
  misunderstood instructions

When revising, generalize from patterns. Do not patch only the exact eval case
unless the skill truly needs that exact special case.
