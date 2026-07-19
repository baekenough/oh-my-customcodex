# Harness Behavioral Policy Reference

Harness policies define coding standards, workflow patterns, and agent behavior
for oh-my-customcodex. This page is a reference overview, not the canonical
source-of-truth for policy counts.

## Codex Surface Contract

Two different policy formats share `.codex/rules/` but have different loaders and
purposes:

| Files | Surface | Loading contract |
|-------|---------|------------------|
| `.codex/rules/*.md` | oh-my-customcodex behavioral policy | `AGENTS.md` explicitly requires agents and routing skills to load or reference the relevant Markdown before scoped work. Markdown here is not applied automatically as a native Codex rule. |
| `.codex/rules/*.rules` | Codex-native command execution policy | Codex loads the Starlark policy to allow, prompt for, or forbid matching shell commands. Create these files only for command-execution policy. |

Do not translate general agent behavior into Starlark command rules. Keep behavior
in the `AGENTS.md` hierarchy or a referenced skill/harness Markdown policy, and
reserve `*.rules` for executable command decisions.

## Overview

| Priority | Role | Purpose |
|----------|-------|---------|
| MUST | Hard constraints | Required - never violate |
| SHOULD | Strong guidance | Recommended - strongly encouraged |
| MAY | Optional guidance | Optional - guidelines |

## MUST Rules

MUST rules are required and should never be violated.

### MUST-language-policy

**ID**: R000

Language and delegation policy:

- User input in Korean
- Output in Korean for user communication
- Code and file contents in English
- Delegation model for file operations

### MUST-safety

**ID**: R001

Safety rules for agent operations:

- No exposure of secrets/API keys
- No system file modifications
- No dangerous command execution
- Required checks before destructive operations

### MUST-permissions

**ID**: R002

Permission rules for tool usage:

- Tier 1: Always allowed (Read, Glob, Grep)
- Tier 2: Default allowed (Write, Edit)
- Tier 3: Requires approval (Bash, WebFetch)
- Tier 4: Explicit request only (Task)

### MUST-agent-design

**ID**: R006

Agent structure requirements:

- Required files (AGENT.md, index.yaml)
- Separation of concerns
- Linking patterns
- Naming conventions

### MUST-agent-identification

**ID**: R007

Agent identification in responses:

- Every response must start with agent identification
- Format: Agent name, type, and task
- No exceptions

### MUST-tool-identification

**ID**: R008

Tool usage identification:

- Every tool call must be prefixed with agent/model identification
- Format: `[agent-name][model] → Tool: <tool-name>`
- Required tool payload fields must be complete before invocation
- Clear tracking of operations

### MUST-parallel-execution

**ID**: R009

Parallel execution requirements:

- Independent tasks must run in parallel
- Maximum 4 parallel instances
- Large tasks must be decomposed

### MUST-orchestrator-coordination

**ID**: R010

Orchestrator coordination:

- Multi-agent tasks require orchestrator
- Orchestrators must not execute work directly
- Clear delegation patterns

### MUST-intent-transparency

**ID**: R015

Intent detection transparency:

- Display reasoning when auto-routing
- Confidence thresholds for confirmation
- Override syntax for explicit routing

### MUST-continuous-improvement

**ID**: R016

Continuous improvement:

- Update rules when violations occur
- Learn from feedback
- Document changes

### MUST-sync-verification

**ID**: R017

Synchronization verification:

- Verify component consistency
- Check documentation sync
- Report discrepancies

### MUST-agent-teams

**ID**: R018

Agent Teams integration (conditional - when Codex/OMX Agent Teams are enabled, for example `OMCODEX_AGENT_TEAMS=1`):

- Mandatory use of Agent Teams for qualifying coordinated tasks
- Decision matrix for Codex native subagents vs Agent Teams
- Team composition patterns
- Graceful fallback to Codex native subagents when disabled

## SHOULD Rules

SHOULD rules are strongly recommended but may have exceptions.

### SHOULD-interaction

**ID**: R003

Interaction guidelines:

- Brevity in responses
- Clarity in instructions
- Transparency about actions
- Status report format

### SHOULD-error-handling

**ID**: R004

Error handling patterns:

- Error classification (Warning, Error, Critical)
- Error report format
- Recovery strategies
- Preventive validation

### SHOULD-memory-integration

**ID**: R011

Memory integration with omx-memory:

- Save before compaction
- Restore on session start
- Project isolation
- Query patterns

### SHOULD-hud-statusline

**ID**: R012

Native HUD and status-line policy:

- OMX HUD for harness workflow state
- Codex `/statusline` and `[tui].status_line` for the native footer
- Absence-only native footer seeding for project config mirrored into isolated OMX `CODEX_HOME`
- Byte-for-byte preservation of custom and explicitly empty status-line assignments
- Fail-closed handling of unsafe project config paths
- Native hook notifications for bounded progress events
- Claude command statusline assets kept behind compatibility boundaries

### SHOULD-ecomode

**ID**: R013

Ecomode for efficiency:

- Compact output format
- Aggregation patterns
- Result compression
- Activation conditions

### SHOULD-verification-ladder

**ID**: R023

Verification ladder guidance:

- Prefer deterministic checks before LLM review
- Run safety-signal rule carve-out pre-checks while authoring rules
- Supply verifier lanes with canonical ground truth for cross-cutting facts
- Escalate to expensive/human review only after cheaper tiers are exhausted

## MAY Rules

MAY rules are optional guidelines.

### MAY-optimization

**ID**: R005

Optimization guidelines:

- Parallel processing when appropriate
- Caching strategies
- Lazy loading
- Token optimization

## Rule Structure

Rules follow this structure:

```markdown
# [PRIORITY] Rule Name

> **Priority**: MUST/SHOULD/MAY
> **ID**: R0XX

## Purpose

Why this rule exists.

## Requirements

### 1. First Requirement

Details and examples.

### 2. Second Requirement

Details and examples.

## Examples

Good and bad patterns.
```

## Harness Policy Locations

Harness behavioral policies remain in `.codex/rules/*.md`:

```
.codex/rules/
├── MUST-language-policy.md
├── MUST-safety.md
├── MUST-permissions.md
├── MUST-agent-design.md
├── MUST-agent-identification.md
├── MUST-tool-identification.md
├── MUST-parallel-execution.md
├── MUST-orchestrator-coordination.md
├── MUST-intent-transparency.md
├── MUST-continuous-improvement.md
├── MUST-sync-verification.md
├── MUST-agent-teams.md
├── SHOULD-interaction.md
├── SHOULD-error-handling.md
├── SHOULD-memory-integration.md
├── SHOULD-hud-statusline.md
├── SHOULD-ecomode.md
├── SHOULD-verification-ladder.md
└── MAY-optimization.md
```

## Modifying Harness Policies

Edit rules directly or create new ones:

```bash
# Edit existing rule
code .codex/rules/MUST-safety.md

# Create new rule
code .codex/rules/SHOULD-my-rule.md
```

## Policy Enforcement

- `AGENTS.md` and referenced skills load applicable Markdown policies into agent context.
- MUST policies are mandatory once loaded by that instruction hierarchy.
- SHOULD policies trigger warnings if violated.
- MAY policies are suggestions only.
- Native `*.rules` files are evaluated separately by Codex for command execution decisions.

See [Customization](/guide/customization) for creating your own rules.
