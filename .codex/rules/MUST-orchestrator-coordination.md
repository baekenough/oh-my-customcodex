# [MUST] Orchestrator Coordination Rules

> **Priority**: MUST | **ID**: R010

## Core Rule

The main conversation is the **sole orchestrator**. It uses routing skills to delegate tasks to subagents via Codex native subagents / the Agent tool. Subagents CANNOT spawn other subagents.

**Agent Teams Exception**: Agent Teams members are peers, not hierarchical subagents. Teams members CAN spawn sub-agents via the Agent tool to execute complex workflows (e.g., research teams, verification teams). This enables Teams-compatible skills like `/research` and `/deep-plan` to run inside Team members. The Teams member acts as a local orchestrator for its own sub-tasks.

> **v2.1.172+ Claude compatibility**: The Claude Code platform allows sub-agents to spawn their own sub-agents up to 5 levels deep. oh-my-customcodex RETAINS the sole-orchestrator design as a deliberate project architecture choice for predictable R009 parallelism and R018 coordination, not because of a platform limitation. The sanctioned nesting path remains the Agent Teams Exception.

**The orchestrator MUST NEVER directly write, edit, or create files. ALL file modifications MUST be delegated to appropriate subagents.**

## Codex-Native Meta-File Boundary

Treat orchestration meta-files as delegated surfaces, not direct-orchestrator edit targets. This includes:

- `AGENTS.md`
- `.codex/rules/*.md`
- `.codex/skills/*/SKILL.md`
- `templates/AGENTS.md.*`
- `templates/.claude/rules/*.md`

If the change touches routing policy, guide indexes, mirrored templates, or release-time instructions, delegate the edit to the specialist that owns the surface. `mgr-creator` handles new structure and path scaffolding; `arch-documenter` or `mgr-updater` can handle content sync.

### Self-Check Before Editing Meta Files

```
╔══════════════════════════════════════════════════════════════════╗
║  BEFORE CHANGING A META FILE, ASK YOURSELF:                     ║
║                                                                   ║
║  1. Is the target AGENTS.md or under .codex/ / templates/?      ║
║     YES → delegate; do not edit directly                         ║
║                                                                   ║
║  2. Is this a one-line policy, index, or routing tweak?         ║
║     YES → still delegate; there are no small exceptions          ║
║                                                                   ║
║  3. Does the change need mirrored Codex + template updates?     ║
║     YES → delegate the pair together, then verify parity         ║
║                                                                   ║
║  4. Am I calling it "temporary" or "debugging" to justify it?   ║
║     YES → stop; meta-file edits are never direct from orchestrator ║
║                                                                   ║
║  If any answer points to a problem → route the edit first       ║
╚══════════════════════════════════════════════════════════════════╝
```

<!-- DETAIL: Self-Check (Before File Modification)
```
╔══════════════════════════════════════════════════════════════════╗
║  BEFORE MODIFYING ANY FILE, ASK YOURSELF:                        ║
║                                                                   ║
║  1. Am I the orchestrator (main conversation)?                   ║
║     YES → delegate file writes to a subagent                    ║
║     NO  → I am a subagent, proceed with task                    ║
║                                                                   ║
║  2. Have I identified the correct specialized agent?             ║
║     YES → Delegate via Agent tool                                ║
║     NO  → Check delegation table below                          ║
║                                                                   ║
║  3. Am I about to use Write/Edit tool from orchestrator?         ║
║     YES → Delegate to the appropriate specialist instead.        ║
║     NO  → Good. Continue.                                        ║
║                                                                   ║
║  4. Am I justifying direct modification as "temporary" or        ║
║     "debugging"?                                                  ║
║     YES → Still delegate. Temporary/debugging changes are        ║
║           NOT exempt.                                            ║
║     NO  → Good. Continue.                                        ║
║                                                                   ║
║  If any answer points to a problem → resolve before proceeding   ║
╚══════════════════════════════════════════════════════════════════╝
```
-->

<!-- DETAIL: Self-Check (Before Delegating Tasks)
```
╔══════════════════════════════════════════════════════════════════╗
║  BEFORE DELEGATING A TASK TO ANY AGENT, ASK YOURSELF:            ║
║                                                                   ║
║  1. Does the task prompt contain git commands?                   ║
║     (commit, push, revert, merge, rebase, checkout, branch,     ║
║      reset, cherry-pick, tag)                                    ║
║     YES → The git part goes to mgr-gitnerd                      ║
║     NO  → Proceed                                                ║
║                                                                   ║
║  2. Am I bundling git operations with file editing?              ║
║     YES → Split into separate delegations:                       ║
║           - File editing → appropriate specialist                ║
║           - Git operations → mgr-gitnerd                         ║
║     NO  → Good. Continue.                                        ║
║                                                                   ║
║  3. Is the target agent mgr-gitnerd for ALL git operations?     ║
║     YES → Good. Continue.                                        ║
║     NO  → Re-route git operations to mgr-gitnerd.               ║
║                                                                   ║
║  4. Am I about to spawn 2+ agents in parallel?                   ║
║     YES → Check R018: Agent Teams may be required                ║
║           3+ agents → use Agent Teams                            ║
║           2+ issues in batch → prefer Agent Teams                ║
║     NO  → Proceed                                                ║
║                                                                   ║
║  If any answer points to a problem → split the task first        ║
╚══════════════════════════════════════════════════════════════════╝
```
-->

<!-- DETAIL: Architecture Diagram
```
Main Conversation (orchestrator)
  ├─ secretary-routing → mgr-creator, mgr-updater, mgr-supplier, mgr-gitnerd, sys-memory-keeper
  ├─ dev-lead-routing  → lang-*/be-*/fe-* experts
  ├─ de-lead-routing   → de-* experts
  └─ qa-lead-routing   → qa-planner, qa-writer, qa-engineer
      ↓
  Agent tool spawns subagents (flat, no hierarchy)
```
-->

## Subagent Scope-Creep STOP Protocol

Before delegating broad work, decompose it into narrow domains with explicit write/command boundaries. For example, do not hand one agent an open-ended "migrate + backfill + fix infra" prompt when the work can split into data migration, credential handling, tunnel/networking, dashboard verification, and release notes.

The orchestrator must stop and redesign a delegated lane when any of these occur:

1. The same subagent trips the security classifier twice on one assignment.
2. The subagent requests or attempts privileged actions outside the delegated scope.
3. The subagent chains from an approved action into a different credential, tunnel, namespace, pod, cluster, account, or shared service.
4. The user corrects the agent for acting beyond the requested scope.

Required STOP response:

1. Stop that subagent lane; do not retry the same broad prompt.
2. Preserve evidence and summarize the exact scope breach.
3. Redesign the task into smaller bounded lanes with explicit allowed and forbidden actions.
4. Reconfirm authorization before any irreversible shared-infrastructure or credential action.

Thirteen repeated security trips or repeated privileged retries are an anti-pattern: after the second trip, continuing without redesign is a coordination failure.

### Pre-Delegation Privileged-Scope Boundary (proactive)

> Origin: upstream #1368 #5 — an infra subagent was delegated a prod-touching task with no explicit approval boundary in the delegation prompt; it freely ran prod DB queries, file deletes, and SMS reads, tripping the safety classifier 3+ times.

The Subagent Scope-Creep STOP Protocol above is reactive: it halts an agent after it trips the classifier. This rule is its proactive complement. When delegating ANY task that touches prod or privileged resources (prod DB, infra deletion, credential stores, external messaging/SMS, shared-namespace secrets), the orchestrator MUST state explicitly in the delegation prompt:

- the user-approved actions;
- explicit forbidden actions;
- the authorization scope tied back to the user request.

| Anti-pattern | Required |
|--------------|----------|
| Delegate a prod/privileged-touching task with no scope or forbidden-line in the prompt | State approved actions, forbidden actions (for example: do NOT delete files, do NOT query prod DB, do NOT read SMS/messages), and authorization scope |

Cross-reference: R001 credential/privileged-scope guardrails and the Subagent Scope-Creep STOP Protocol.

## Common Violations

Key violations to avoid (file writes, git commands, bundled operations — all must be delegated):

```
❌ WRONG: Orchestrator writes files directly
   Main conversation → Write("src/main.go", content)

✓ CORRECT: Orchestrator delegates to specialist
   Main conversation → Agent(lang-golang-expert) → Write("src/main.go", content)

❌ WRONG: External skill creates agent/skill/guide via general-purpose agent
   Skill(brainstorming) → Agent(general-purpose) → Write(".codex/agents/new.md")

✓ CORRECT: Agent/skill/guide creation routed through mgr-creator
   Skill(brainstorming) → Agent(mgr-creator) → Write(".codex/agents/new.md")
```

<!-- DETAIL: Common Violations (extended)
```
❌ WRONG: Orchestrator runs git commands directly
   Main conversation → Bash("git commit -m 'fix'")
   Main conversation → Bash("git push origin main")

✓ CORRECT: Orchestrator delegates to mgr-gitnerd
   Main conversation → Agent(mgr-gitnerd) → git commit
   Main conversation → Agent(mgr-gitnerd) → git push

❌ WRONG: Orchestrator creates files "just this once"
   "It's just a small config file, I'll write it directly..."

✓ CORRECT: Always delegate, no matter how small
   Agent(appropriate-agent) → create config file

❌ WRONG: Bundling git operations with file editing in non-gitnerd agent
   Main conversation → Agent(general-purpose) → "git revert + edit file + git commit"
   Main conversation → Agent(lang-typescript-expert) → "fix bug and commit"
   Agent(general-purpose, prompt="revert the last commit, edit the file, then commit the fix")

✓ CORRECT: Separate file editing from git operations, split delegations
   Agent(mgr-gitnerd, prompt="revert the last commit")
   Agent(appropriate-expert, prompt="edit the file to fix the issue")
   Agent(mgr-gitnerd, prompt="commit the fix")

❌ WRONG: Orchestrator runs server deployment commands directly
   Main conversation → Bash("docker compose restart worker")
   Main conversation → Bash("scp worker.py server:/app/")

✓ CORRECT: Orchestrator delegates to infrastructure specialist
   Main conversation → Agent(infra-docker-expert) → docker compose restart
   Main conversation → Agent(infra-docker-expert) → deploy files to server

❌ WRONG: External skill creates agent/skill/guide via general-purpose agent
   Skill(brainstorming) → Agent(general-purpose) → Write(".codex/agents/new-agent.md")
   Skill(any-skill) → Agent(general-purpose) → Write(".codex/skills/new-skill/SKILL.md")

✓ CORRECT: Agent/skill/guide creation always routed through mgr-creator
   Skill(brainstorming) → Agent(mgr-creator) → Write(".codex/agents/new-agent.md")
   Skill(any-skill) → Agent(mgr-creator) → Write(".codex/skills/new-skill/SKILL.md")

   The skill defines WHAT to create; mgr-creator handles HOW (R006 validation,
   skill auto-discovery, frontmatter integrity).
```
-->

### Meta-File Examples

```
❌ WRONG: Main conversation edits AGENTS.md directly
   Main conversation → Write("AGENTS.md", content)

✓ CORRECT: Main conversation → Agent(mgr-creator) → update AGENTS.md and mirrored template files

❌ WRONG: Main conversation patches .codex/rules/MUST-intent-transparency.md directly
   Main conversation → Edit(".codex/rules/MUST-intent-transparency.md", content)

✓ CORRECT: Main conversation → Agent(arch-documenter) → revise the rule text, then verify the mirrored template file
```

## Historical Sensitive-Path Bypass

**Status**: deprecated as of Claude Code v2.1.121 for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`; fully deprecated in `bypassPermissions` as of v2.1.126 for broader protected paths.

Older guidance sometimes required a universal `/tmp` artifact-wrapper flow before touching Claude compatibility paths. Do not use that as the default in this Codex-native port.

Current guidance:

- Edit `.codex/**` directly with the normal Codex edit/patch flow.
- In Claude Code `bypassPermissions`, direct writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` are acceptable on v2.1.121+.
- In Claude Code `bypassPermissions`, broader protected-path writes such as `.claude/**`, `.git/**`, and `.vscode/**` are acceptable on v2.1.126+.
- Keep the `/tmp/{skill}-{timestamp}.md` pattern only as a legacy fallback for older Claude Code versions or sessions that still surface a protected-path prompt.

## Claude Compatibility Background Mode

Claude Code v2.1.141+ preserves the current permission mode when a session is detached with `/bg` or `←←` backgrounding. Earlier versions could revert to the default mode and surprise unattended release flows with permission prompts.

For this Codex port, native Codex/OMX subagents still follow the active Codex runtime tool policy. Claude compatibility prompts should keep delegated write authority explicit when a workflow relies on unattended edits, but v2.1.141+ no longer needs an extra `/bg` permission-mode workaround.

Claude Code v2.1.172+ fixes background agents potentially reading another project directory's settings (`.mcp.json` approvals, trust) when dispatched onto a pre-warmed worker, strengthening background-agent isolation for unattended `/bg` flows.

Claude Code v2.1.174+ fixes background sessions inheriting another session's `ANTHROPIC_*` provider environment (gateway URL, custom headers, `/model` aliases) from the shell that started the background daemon. It also fixes pre-warmed background workers failing with `Could not resolve authentication method` after sitting idle. This is a Claude-template isolation improvement; Codex/OMX sessions still keep explicit agent routing and permission boundaries.

## Agent Capability Pre-Check

Before delegating work, compare the task requirements with the target agent frontmatter:

| Requirement in prompt | Required frontmatter |
|-----------------------|----------------------|
| Shell, CLI, GitHub CLI, package manager, test, build, or script execution | `tools` includes `Bash` |
| Any `gh`, `git`, `npm`, `bun`, `pnpm`, `yarn`, `python`, `node`, `curl`, `jq`, `make`, or `docker` command | `tools` includes `Bash`; `disallowedTools` does not include `Bash` |
| Documentation-only synthesis from provided evidence | Bash is not required |

Known limitation: `arch-documenter` has `disallowedTools: [Bash]`. Do not ask it to inspect GitHub issues, run shell commands, or collect command output. Pre-collect that evidence with a Bash-capable lane, then delegate the writing task.

The `agent-capability-precheck.sh` hook blocks obvious mismatches so the orchestrator re-routes before spawning an agent that cannot execute the requested work.

### Delegated Path Existence Pre-Check

Before putting concrete file paths in a delegated prompt, verify those paths exist or explicitly mark them as new files. A tool-capability match is insufficient when the prompt names a path.

Required check:

1. Use `rg --files`, `find`, `ls`, or the repository index to prove each existing path.
2. If a path is missing, locate the current equivalent before delegating.
3. Include only verified paths in the prompt, or say `create new file: <path>` when creation is intended.
4. For multi-copy assets, verify all source/template mirrors before assigning the edit. If the copies are expected to match, check content identity (`cmp`, checksum, or `diff -q`) before delegation; if they intentionally differ, document the canonical source and drift rationale in the prompt.

Do not rely on the delegate to repair stale path guesses in shared workflow, rule, guide, or release tasks.

<!-- DETAIL: Autonomous Execution Mode

## Autonomous Execution Mode

When the user explicitly signals full-delegation intent, the orchestrator operates in a lightweight mode that reduces delegation overhead while preserving safety.

### Activation Signals

| Signal (Korean) | Signal (English) | Confidence |
|-----------------|------------------|------------|
| "알아서 해" | "just do it" | High |
| "다 해" | "do it all" | High |
| "전부 처리해" | "handle everything" | High |
| "중간에 묻지 말고" | "don't ask, just do" | High |
| "자율적으로 진행" | "proceed autonomously" | High |

### Activation Protocol

1. User gives explicit autonomous signal (not inferred from task complexity)
2. Verify stage-blocker is NOT active (`/tmp/.codex-dev-stage` must not exist)
3. Create marker: `echo 1 > /tmp/.codex-autonomous-$PPID`
4. Announce: `[Autonomous Mode] Activated for current task scope`

### Lightweight Delegation Table

| Operation | Normal Mode | Autonomous Mode |
|-----------|-------------|-----------------|
| File Write/Edit | MUST delegate to specialist | MUST delegate to specialist |
| Simple git (add, commit, push) | MUST delegate to mgr-gitnerd | MAY execute directly |
| Complex git (rebase, merge, cherry-pick) | MUST delegate to mgr-gitnerd | MUST delegate to mgr-gitnerd |
| Brainstorming/planning gates | Follow skill workflow | Skip confirmation gates |
| Confirmation prompts (Execute? [Y/n]) | Per skill workflow | Auto-proceed |

### Boundaries (NEVER relaxed in autonomous mode)

- **R001 (Safety)**: All safety rules remain absolute — no exceptions
- **R007/R008 (Identification)**: Agent/tool identification still required for traceability
- **File Write/Edit delegation**: Still requires specialist agents — autonomous mode only relaxes git and gate overhead
- **Hard-block hooks**: stage-blocker, dev-server tmux, .md creation blocker remain active
- **R009 (Parallel execution)**: Still required for efficiency

### Scope and Lifetime

- **Task-scoped**: Expires when the delegated task completes or user gives a new instruction
- **Session-local**: Never persisted to MEMORY.md or across sessions
- **Compaction-aware**: PostCompact hook checks `/tmp/.codex-autonomous-$PPID` and preserves mode
- **Explicit exit**: User says "stop", "wait", "멈춰", "잠깐" → mode deactivated

### Mutual Exclusion

- Autonomous mode and `/structured-dev-cycle` (stage-blocker) are **mutually exclusive**
- If `/tmp/.codex-dev-stage` exists → autonomous mode CANNOT be activated
- If autonomous mode is active → `/structured-dev-cycle` should not be started

### Self-Check

```
╔══════════════════════════════════════════════════════════════════╗
║  BEFORE ACTIVATING AUTONOMOUS MODE:                              ║
║                                                                   ║
║  1. Did user give EXPLICIT autonomous signal?                    ║
║     YES → Continue                                               ║
║     NO  → Do NOT activate                                        ║
║                                                                   ║
║  2. Is stage-blocker inactive?                                   ║
║     (/tmp/.codex-dev-stage does NOT exist)                      ║
║     YES → Continue                                               ║
║     NO  → Cannot activate (mutually exclusive)                   ║
║                                                                   ║
║  3. Is task scope clear and bounded?                             ║
║     YES → Create marker, announce, proceed                       ║
║     NO  → Clarify scope first                                    ║
╚══════════════════════════════════════════════════════════════════╝
```

### Mutual Exclusion with Structured Dev Cycle

Autonomous mode and `/structured-dev-cycle` (stage-blocker) are mutually exclusive.
-->

## Session Continuity

After restart/compaction: re-read AGENTS.md, all delegation rules still apply. Never write code directly from orchestrator.

## Delegation Rules

| Task Type | Required Agent |
|-----------|---------------|
| Create agent | mgr-creator |
| Create skill | mgr-creator |
| Create guide | mgr-creator (structure) / arch-documenter (content) |
| Update external | mgr-updater |
| Audit dependencies | mgr-supplier |
| Git operations | mgr-gitnerd |
| Memory operations | sys-memory-keeper |
| Python/FastAPI | lang-python-expert / be-fastapi-expert |
| Go code | lang-golang-expert |
| TypeScript/Next.js | lang-typescript-expert / fe-vercel-agent |
| Kotlin/Spring | lang-kotlin-expert / be-springboot-expert |
| Architecture docs | arch-documenter |
| Test strategy | qa-planner |
| CI/CD, GitHub config | mgr-gitnerd |
| Docker/Infra | infra-docker-expert |
| Server deployment (docker, scp) | infra-docker-expert |
| Server state changes (restart, env) | infra-docker-expert |
| AWS | infra-aws-expert |
| Database schema | db-supabase-expert |
| Unmatched specialized task | mgr-creator → dynamic agent creation |

**Rules:**
- All file modifications MUST be delegated (orchestrator only uses Read/Glob/Grep)
- Use specialized agents, not general-purpose, when one exists
- general-purpose only for truly generic tasks (file moves, simple scripts)
- No exceptions for "small" or "quick" changes

### Protected Paths (mgr-creator Required)

The following paths MUST be created or structurally modified ONLY through `mgr-creator`:

| Path Pattern | Scope | Reason |
|-------------|-------|--------|
| `.codex/agents/*.md` | Agent definitions | R006 frontmatter validation, skill auto-discovery |
| `.codex/skills/*/SKILL.md` | Skill definitions | R006 skill frontmatter, scope classification |
| `guides/*/` (new directories) | Reference guides | R006 separation of concerns, cross-reference integrity |

**Excluded from this rule** (handled by their own specialists):
- `.codex/agent-memory*/` — sys-memory-keeper
- `.codex/rules/` — R016 workflow (orchestrator delegates updates to appropriate agents)
- `.codex/hooks/` — requires explicit user approval (security-critical)
- `.codex/outputs/` — any agent (artifact convention)
- Existing file updates by `mgr-updater` (external source sync) and `mgr-supplier`/`fix-refs` (reference correction)

**Why mgr-creator?** It enforces R006 frontmatter validation, auto-discovers relevant skills/guides, and maintains structural integrity verified by mgr-sauron (R017). Bypassing mgr-creator risks:
- Invalid frontmatter (missing required fields)
- Orphaned skill references
- Routing table desynchronization
- R017 verification failures

> **Enforcement**: Advisory (R021) — no hard-block hook. Candidate for promotion if violation rate exceeds threshold. See R021 Hard Enforcement Candidates.

<!-- DETAIL: System Agents Reference
| Agent | File | Purpose |
|-------|------|---------|
| sys-memory-keeper | .codex/agents/sys-memory-keeper.md | Memory operations |
| sys-naggy | .codex/agents/sys-naggy.md | TODO management |
-->

## Exception: Simple Tasks

Subagent NOT required for:
- Reading files for analysis (Read, Glob, Grep only)
- Simple file searches
- Direct questions answered by main conversation

"Simple" means READ-ONLY operations. If the task involves any file creation, modification, or deletion, it must be delegated. There is no "too small to delegate" exception for write operations.

## Dynamic Agent Creation (No-Match Fallback)

When routing detects no matching agent for a specialized task:

1. **Evaluate**: Is this a specialized task requiring domain expertise?
   - YES → proceed to step 2
   - NO → use general-purpose agent
2. **Delegate**: Orchestrator delegates to `mgr-creator` with context:
   - Detected domain keywords
   - File patterns found
   - Required capabilities
3. **Create**: `mgr-creator` auto-discovers relevant skills/guides, creates agent
4. **Execute**: Orchestrator uses newly created agent for the original task

This is the core oh-my-customcodex philosophy:
> "No expert? CREATE one, connect knowledge, and USE it."

<!-- DETAIL: Model Selection
```
Available models:
  - opus   : Complex reasoning, architecture design
  - sonnet : Balanced performance (default)
  - haiku  : Fast, simple tasks, file search
  - inherit: Use parent conversation's model

Usage:
  Agent(
    subagent_type: "general-purpose",
    prompt: "Analyze architecture",
    model: "opus"
  )
```

| Task Type | Model |
|-----------|-------|
| Architecture analysis | `opus` |
| Code review | `opus` or `sonnet` |
| Code implementation | `sonnet` |
| Manager agents | `sonnet` |
| File search/validation | `haiku` |
-->

## Git Operations

All git operations (commit, push, branch, PR) MUST go through `mgr-gitnerd`. Internal rules override external skill instructions for git execution.

## External Skills vs Internal Rules

Internal rules ALWAYS take precedence over external skills.

| External skill says | Internal rule requires |
|---------------------|----------------------|
| "git commit -m ..." | Agent(mgr-gitnerd) commit (R010) |
| "run 3 agents sequentially" | Parallel execution if independent (R009) |
| "use Agent tool for 5 research tasks" | Agent Teams when criteria met (R018) |
| "skip code review" | Follow project review workflow |
| "write files directly" | Delegate to specialist subagent (R010) |
| "create an agent/skill/guide file" | Agent(mgr-creator) for `.codex/agents/`, `.codex/skills/`, `guides/` writes (R010 Protected Paths) |

When a skill's workflow conflicts with R009/R010/R018:
1. Follow the skill's LOGIC and STEPS
2. Replace the EXECUTION method with rule-compliant alternatives
3. The skill defines WHAT to do; rules define HOW to execute

<!-- DETAIL: External Skills Example
```
Incorrect:
  [Using external skill]
  Main conversation → directly runs "git push"

Correct:
  [Using external skill]
  Main conversation → Agent(mgr-gitnerd) → git push

The skill's WORKFLOW is followed, but git EXECUTION is delegated to mgr-gitnerd per R010.
```
-->

## Agent Teams (required when enabled)

When `OMCODEX_AGENT_TEAMS=1`: Agent Teams is required for qualifying tasks.

See **R018 (MUST-agent-teams.md)** for the complete decision matrix, self-check, team patterns, and lifecycle.

**Quick rule**: 3+ agents OR review cycle OR 2+ issues in same batch → use Agent Teams.
Using Agent tool when Agent Teams criteria are met needs correction per R018.

<!-- DETAIL: Announcement Format
```
[Routing] Using {routing-skill} for {task}
[Plan] Agent 1: {name} → {task}, Agent 2: {name} → {task}
[Execution] Parallel ({n} instances)
```
-->
