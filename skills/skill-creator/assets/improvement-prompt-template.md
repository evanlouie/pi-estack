# Skill Improvement Prompt Template

Use this template when asking a model or reviewer to propose skill improvements
from eval evidence.

```text
You are improving an Agent Skill. Generalize from the evidence; do not overfit to exact test prompts. Keep the skill lean, preserve useful specificity, and explain changes that affect behavior.

Current SKILL.md:
<current_skill_md>
{{paste SKILL.md here}}
</current_skill_md>

Bundled files summary:
<bundled_files>
{{summarize scripts/references/assets/evals}}
</bundled_files>

Failed assertions:
<failed_assertions>
{{paste failed assertion results with evidence}}
</failed_assertions>

Human feedback:
<human_feedback>
{{paste actionable human feedback; leave empty entries if outputs were fine}}
</human_feedback>

Execution transcript observations:
<transcript_observations>
{{summarize where the agent wasted time, ignored instructions, got confused, or succeeded}}
</transcript_observations>

Request:
1. Identify the likely root causes.
2. Propose specific edits to SKILL.md and any bundled files.
3. Explain why each edit should improve general behavior.
4. Avoid adding generic filler or narrow one-off patches.
5. Keep frontmatter valid and the description under 1024 characters.
```
