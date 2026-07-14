---
name: skill-extractor
description: Analyze recurring task trajectories and evidence to propose reusable workflow packaging candidates
scope: core
user-invocable: true
argument-hint: "[--threshold <n>] [--dry-run] [--all]"
version: 1.1.0
---

# Skill Extractor

Analyze completed task outcomes and recent work evidence to identify recurring workflows that may deserve reusable packaging. Inspired by Hermes Agent's self-learning skill extraction — adapted for oh-my-customcodex's compilation metaphor.

## Philosophy

In the compilation metaphor: task trajectories are runtime traces, and extracted skills are new source code. This skill turns repeated, successful execution patterns into reusable knowledge artifacts only after evidence review and user approval.

```
Runtime traces + memory + rollout summaries + inventory → Evidence-first shortlist → Packaging recommendation → User approval → mgr-creator or automation owner
```

## Usage

```
/skill-extractor                    # Analyze current session outcomes and local evidence
/skill-extractor --threshold 2      # Lower recurring evidence threshold (default: 3)
/skill-extractor --dry-run          # Preview shortlist without writing
/skill-extractor --all              # Include broader session and memory history when available
```

## Options

```
--threshold, -t   Minimum evidence count for recurring-workflow qualification (default: 3)
--dry-run, -d     Preview candidates to stdout only, no file writes
--all             Include all sessions and available memory/history, not just current session
```

## Workflow

### Phase 1: Evidence-First Candidate Discovery

Collect candidates from concrete, dated evidence before proposing any packageable artifact. Prefer local evidence first; use optional integrations only when available.

Required and recommended sources:

1. **Recent session outcomes** from the task-outcome-recorder hook:

   ```bash
   # Current session outcomes
   OUTCOMES_FILE="/tmp/.codex-task-outcomes-${PPID}"
   ```

2. **Recent sessions and memory**: relevant `claude-mem`/OMX memory observations, session checkpoints, `.omx/notepad.md`, and `.omx/state/**` summaries when present.
3. **Rollout or release summaries**: changelog entries, release notes, PR summaries, compatibility notes, and post-release follow-up reports that show repeated manual steps.
4. **Optional Chronicle/history integrations**: Chronicle, shell history, or external task timeline summaries if installed and explicitly available. Do not fail when absent.
5. **Existing inventory**: compare against `.codex/skills/*/SKILL.md`, `.codex/agents/*`, `templates/.claude/skills/*/SKILL.md`, and generated wiki pages to avoid duplicate or overlapping packaging.

If no evidence source exists or all sources are empty: report "No recurring workflow evidence found." and stop without creating anything.

Parse JSONL outcome entries when available. Each entry has:

```json
{"agent_type": "lang-typescript-expert", "skill": "typescript-best-practices", "description": "Fix type error in auth module", "outcome": "success", "model_lane": "frontier", "model_reasoning_effort": "medium", "timestamp": "2026-04-05T09:30:00Z", "duration_ms": 15000}
```

For prose evidence, extract only dated or source-attributed observations, for example:

```markdown
- 2026-05-24, release PR summary: repeated manual wiki parity fixes after adding new guides.
- 2026-05-22, memory #29064: sync-upstream-release-issues dry-run needed repeated validation after issue-reference parsing changes.
```

### Phase 2: Recurring Workflow Detection

Group evidence by the workflow being repeated, not only by `(agent_type, skill)` tuple. A workflow can span agents, commands, checklist steps, or release procedures.

```
Workflow: release-docs-parity-check
  → evidence_count: 4 dated occurrences
  → successful_reuse: 3
  → failure_or_friction: 1
  → sources: [memory:29148, PR summary, changelog, wiki staleness check]
  → existing_overlap: wiki, update-docs, sauron-watch
```

Filter qualifying candidates:

- `evidence_count >= threshold` (default: 3), or two strong dated incidents plus high user impact.
- Repeated manual judgment or sequencing exists; one-off bugs are not enough.
- Evidence includes dates or source names, not vague recollection.
- Candidate is not already fully covered by an existing skill, custom subagent, automation, or documented checklist.
- R006 separation of concerns can be preserved: package one coherent responsibility, not a catch-all meta-agent.

### Phase 3: Build the Shortlist

For each candidate, create a shortlist entry before generating any SKILL.md proposal. Every entry must include these fields:

```markdown
## Candidate: {candidate-name}

**Workflow**: {one-sentence recurring workflow description}
**Evidence / Dates**:
- {date or source}: {specific repeated task, success, failure, or friction point}
- {date or source}: {specific repeated task, success, failure, or friction point}
**Frequency / Confidence**: {count and low|medium|high confidence with reason}
**Recommended Form**: {Skill | Custom subagent | Automation | Skip}
**Duplicate / Overlap Check**: {existing skills, agents, hooks, scripts, docs, or "none found"}
**Why**: {why packaging would reduce repeated manual work or improve safety}
**Why Not**: {risks, overlap, insufficient evidence, or why a lighter form may be better}
```

Recommended-form guidance:

| Form | Use When | Do Not Use When |
|------|----------|-----------------|
| Skill | A repeatable human-invoked workflow/checklist improves outcomes and needs judgment | Existing skill already covers it or it is fully automatable |
| Custom subagent | A specialized role with stable responsibilities, tools, and boundaries is recurring | It is just a checklist or would violate R006 by mixing unrelated duties |
| Automation | The steps are deterministic, cheap to validate, and safe to run without judgment | User approval, external credentials, or destructive actions are required |
| Skip | Evidence is weak, duplicated, obsolete, or one-off | There is enough dated evidence and clear reuse value |

### Phase 4: Generate Packaging Proposals

Only for shortlist entries whose recommended form is `Skill` or `Custom subagent`, generate a proposal. For `Automation`, recommend the script/hook/check location and required guardrails. For `Skip`, explain the evidence gap.

```markdown
## Proposal: {proposed-package-name}

**Recommended Form**: {Skill | Custom subagent | Automation | Skip}
**Source Workflow**: {workflow} ({evidence_count} evidence points, {confidence})
**Evidence Window**: {earliest date/source} → {latest date/source}
**Confidence**: {low|medium|high} (based on frequency, recency, and outcome consistency)

### Proposed Artifact

name: {proposed-name}
description: {inferred from recurring workflow evidence}
scope: core
user-invocable: {true|false}

### Rationale
{Why this workflow should be packaged — based on dates, frequency, success/failure pattern, and user impact}

### Duplicate / Overlap Check
{List existing skills, agents, hooks, scripts, or wiki docs with meaningful overlap and how this proposal differs}

### Guardrails
{User approval, R006 responsibility boundary, R020 verification requirement, dry-run behavior, and non-destructive defaults}
```

**Confidence scoring**:

| Evidence | Recency / Outcome | Confidence |
|----------|-------------------|------------|
| 2 strong incidents or 3 weak signals | Mixed outcomes or older than 90 days | low |
| 3-5 dated occurrences | Mostly successful or repeated friction in last 90 days | medium |
| 6+ dated occurrences | Clear recurrence, recent evidence, and stable success criteria | high |

### Phase 5: Present to User

Display the shortlist in ranked order (highest confidence and lowest overlap first):

```text
[skill-extractor] {N} recurring workflow candidates detected

  1. [high] release-docs-parity-check
     Workflow: Validate guide/wiki/template parity before release PRs
     Evidence: 4 dated sources, latest 2026-05-24
     Recommended form: Skill
     Overlap: update-docs, sauron-watch (partial)
     Why: Prevents repeated CI wiki-staleness failures
     Why not: May be redundant if update-docs grows the same gate

  2. [medium] upstream-release-issue-validation
     Workflow: Validate upstream issue references before sync workflows
     Evidence: 3 dated sources, latest 2026-05-22
     Recommended form: Automation
     Overlap: sync-upstream-release-issues script
     Why: Deterministic validation prevents repeated 404 workflow failures
     Why not: Better as script/test than human-invoked skill

Select [1-N] to create, "all" to create all approved packageable items, or "skip" to cancel:
```

### Phase 6: Create Artifact (on approval only)

Never create or modify reusable artifacts without explicit user approval after showing the shortlist.

On approval:

- `Skill`: delegate to `mgr-creator` with the full shortlist entry, proposal, overlap warnings, and guardrails.
- `Custom subagent`: delegate to `mgr-creator` with the R006 responsibility boundary and required related skills/guides.
- `Automation`: hand off a scoped implementation recommendation; require a dry-run/default-safe mode and R020 verification evidence.
- `Skip`: record the decision only if the user asks to save it.

mgr-creator handles: SKILL.md creation, template sync, ontology registration, and generated docs parity.

## Recurring-Workflow Packaging Checklist

Before recommending packaging, verify:

- [ ] Evidence is source-attributed and includes dates or stable identifiers.
- [ ] Frequency meets `--threshold` or has two strong high-impact incidents.
- [ ] The workflow has stable trigger conditions and a clear stop condition.
- [ ] Existing skills, agents, hooks, scripts, and wiki docs were checked for duplicate or partial coverage.
- [ ] Recommended form is justified as `Skill`, `Custom subagent`, `Automation`, or `Skip`.
- [ ] `Why` and `Why Not` both name concrete evidence.
- [ ] R006 is preserved: one coherent responsibility and clear boundaries.
- [ ] R020 is preserved: proposal includes verification evidence or a test/check path.
- [ ] User approval is required before any artifact creation or mutation.
- [ ] Dry-run/no-write behavior remains available for review-only usage.

## Integration

| System | How |
|--------|-----|
| task-outcome-recorder | Reads JSONL outcomes as one input data source |
| memory-management / memory-recall | Supplies dated recurring-workflow evidence when available |
| rollout and release summaries | Surface repeated manual release, docs, and compatibility procedures |
| optional Chronicle/history | Adds timeline evidence when installed; absence is non-fatal |
| existing skills and agents inventory | Prevents duplicate skills, subagents, or automations |
| feedback-collector | Complementary: feedback-collector extracts failure patterns, skill-extractor extracts recurring packageable workflows |
| mgr-creator | Delegated skill or subagent creation on user approval |
| skills-sh-search | Check agentskills.io for existing equivalent before creating |
| R006 | Enforces coherent responsibility boundaries for custom subagents and skills |
| R011 (memory) | User Model tracks extraction decisions in Override Decisions when explicitly saved |
| R020 | Requires verification evidence before completion claims |

## Hook Integration

The `skill-extractor-analyzer.sh` Stop hook provides a lightweight pre-analysis:

- Reads task outcomes file
- Counts qualifying recurring patterns
- Emits advisory stderr message if candidates found
- Does NOT create skills, subagents, or automation (that requires user approval via the skill)

## Compatibility Artifact Protocol

Sensitive-path compatibility note: when delegated work touches `.claude/outputs/`, `.claude/**`, or `templates/.claude/**`, keep `.codex/**` artifacts on the normal file-write path. On Claude Code v2.1.121+ with `bypassPermissions`, direct compatibility writes are allowed for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`; on v2.1.126+ broader protected paths are covered. Use `/tmp/<skill>-<timestamp>.md` only as a legacy fallback when the runtime is older or still prompts.

## Safety

- **User approval required**: Never auto-creates skills, subagents, or automation
- **Evidence-first**: Never recommends packaging from vague memory or unverified anecdotes
- **Overlap check**: Prevents duplicating existing skills, agents, hooks, scripts, or docs
- **R006 guardrail**: Rejects catch-all artifacts with mixed responsibilities
- **R020 guardrail**: Every approved artifact must include a verification path before completion is claimed
- **Dry-run mode**: Preview without side effects
- **Advisory hook**: Stop hook is advisory-only (exit 0)
- **Confidence transparency**: All shortlist entries and proposals show confidence scores and evidence dates
