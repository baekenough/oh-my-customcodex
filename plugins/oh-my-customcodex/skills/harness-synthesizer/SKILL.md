---
name: harness-synthesizer
description: Synthesize code harnesses for agent action validation — AutoHarness-inspired verifier/filter/policy generation
scope: core
version: 1.0.0
user-invocable: true
argument-hint: "[--mode verifier|filter|policy] [--agent <name>] [--dry-run]"
effort: high
---

# Harness Synthesizer Skill

## Purpose

Synthesize executable validation harnesses for agent tool calls, inspired by AutoHarness (Google DeepMind, arxiv 2603.03329). Generates code-level verifiers that check action validity before or after execution, reducing agent errors through structured constraint enforcement.

Default mode is advisory (verifier). Hard enforcement requires explicit `--hard-enforce` opt-in per R021.

## Three Modes

| Mode | Flag | Behavior | Enforcement |
|------|------|----------|-------------|
| `verifier` | default | Post-hoc check: validates tool call results after execution | Advisory only |
| `filter` | `--mode filter` | Pre-execution check: blocks invalid tool calls | Opt-in, requires `--hard-enforce` |
| `policy` | `--mode policy` | Suggests the best valid action from available options | Advisory only |

### Verifier Mode (Default)

Generates a YAML harness that describes post-execution checks for each tool the agent uses. Checks are emitted as advisory warnings — they do not block execution.

```yaml
# Example verifier harness output
harness:
  agent: lang-golang-expert
  mode: verifier
  rules:
    - tool: Write
      checks:
        - field: file_path
          pattern: ".*\\.go$"
          on_fail: warn  # advisory
        - field: content
          must_not_contain: "TODO:"
          on_fail: warn
    - tool: Bash
      checks:
        - command_pattern: "^(go build|go test|go fmt|go vet)"
          on_fail: warn
```

### Filter Mode (Opt-in)

Generates pre-execution filter rules. Requires `--hard-enforce` flag. Used when advisory warnings are insufficient and the risk of invalid actions is high.

```yaml
# Example filter harness output (--hard-enforce)
harness:
  agent: mgr-gitnerd
  mode: filter
  enforcement: hard
  rules:
    - tool: Bash
      blocks:
        - pattern: "git push --force"
          reason: "Force push to protected branch"
        - pattern: "git reset --hard"
          reason: "Destructive reset without confirmation"
```

### Policy Mode

Generates a policy function that ranks valid actions and suggests the best one. Useful for agents with multiple valid paths to the same goal.

```yaml
# Example policy harness output
harness:
  agent: qa-engineer
  mode: policy
  policies:
    - scenario: "test file modification"
      preferred_sequence:
        - tool: Read
          reason: "Read before modifying"
        - tool: Edit
          reason: "Edit is safer than Write for existing files"
      avoid:
        - tool: Write
          on_existing_file: true
          reason: "Overwrites without diff"
```

## Workflow

1. **Read target agent frontmatter** — extract `tools`, `domain`, `limitations` fields
2. **Analyze recent tool call patterns** — check `.codex/outputs/` for prior session logs (if available)

### Compatibility artifact protocol

Sensitive-path compatibility note: when delegated work touches `.claude/outputs/`, `.claude/**`, or `templates/.claude/**`, keep `.codex/**` artifacts on the normal file-write path. On Claude Code v2.1.121+ with `bypassPermissions`, direct compatibility writes are allowed for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`; on v2.1.126+ broader protected paths are covered. Use `/tmp/<skill>-<timestamp>.md` only as a legacy fallback when the runtime is older or still prompts.

3. **Synthesize validation harness** — generate YAML harness matching agent's declared capabilities
4. **Refine via evaluator-optimizer loop** — iterate harness against edge cases (3 rounds max)
5. **Save output** — write to `.codex/outputs/harnesses/{agent-name}-{mode}.yaml`
6. **Report** — print harness summary and integration instructions

## Integration

| System | How |
|--------|-----|
| `action-validator` | Harness output feeds into action-validator's code-verified mode |
| `adaptive-harness --learn` | Auto-triggers harness-synthesizer for project-specific patterns |
| `evaluator-optimizer` | Provides iterative refinement loop (gradient-free optimization) |
| `pipeline-guards` | Harness checks usable as pipeline quality gates |

## Two-Stage Isolation Pattern

Use two-stage isolation when generated verifier/filter/policy code must execute sample inputs during synthesis. Stage 1 encodes the candidate harness and fixtures as Base64 so shell quoting, prompt delimiters, and embedded newlines cannot change the payload. Stage 2 decodes inside a subprocess with a narrow environment and validates the behavior through stdin/stdout only.

```yaml
harness:
  agent: mgr-gitnerd
  mode: verifier
  isolation:
    stage_1_payload:
      encoding: base64
      includes:
        - candidate_harness
        - fixtures
        - expected_results
    stage_2_runner:
      command: "node /tmp/harness-runner.mjs"
      env:
        NODE_OPTIONS: "--no-warnings"
      stdin: base64_payload
      timeout_ms: 5000
      network: disabled
  checks:
    - name: rejects force push
      fixture: "git push --force origin main"
      expect:
        valid: false
        reason_contains: "Force push"
```

Prefer this pattern over inline shell snippets when the fixture contains quotes, heredocs, JSON, or code blocks. The subprocess must receive only the encoded payload and return structured JSON; do not let it read project files unless the policy explicitly requires file-system evidence.

## Usage Examples

```bash
# Generate advisory verifier for lang-golang-expert
/harness-synthesizer --agent lang-golang-expert --mode verifier

# Dry-run: preview harness without saving
/harness-synthesizer --agent mgr-gitnerd --mode filter --dry-run

# Generate hard-enforce filter (explicit opt-in)
/harness-synthesizer --agent mgr-gitnerd --mode filter --hard-enforce

# Generate policy harness
/harness-synthesizer --agent qa-engineer --mode policy
```

## R021 Compliance

- Default `verifier` mode: advisory only — never blocks tool execution
- `filter` mode without `--hard-enforce`: advisory only — emits warnings
- `filter --hard-enforce`: opt-in hard enforcement — requires explicit user flag
- All harness output is saved to `.codex/outputs/harnesses/` (git-untracked)

## Output Format

Harnesses are saved as YAML at `.codex/outputs/harnesses/{agent-name}-{mode}.yaml`. Each harness includes:

```yaml
harness:
  agent: {agent-name}
  mode: verifier | filter | policy
  version: 1.0.0
  generated: {ISO-8601 timestamp}
  enforcement: advisory | hard  # hard only with --hard-enforce
  rules: [...]
```
