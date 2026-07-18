---
name: research
description: 10-team parallel deep analysis with cross-verification for any topic, repository, or technology. Use when user invokes /research or asks for comprehensive research.
scope: core
user-invocable: true
teams-compatible: true
---

# Research Skill

Orchestrates 10 parallel research teams for comprehensive deep analysis of any topic, GitHub repository, or technology. Produces a structured report with ADOPT/ADAPT/AVOID taxonomy.

**Teams-compatible** — works both from the main conversation (R010) and inside Agent Teams members. When used in Teams, the member directly executes the research workflow without Skill tool invocation.

## Usage

```
/research <topic-or-url>
/research https://github.com/user/repo
/research "distributed consensus algorithms"
/research Rust async runtime comparison
```

## When NOT to Use

| Scenario | Better Alternative |
|----------|--------------------|
| Simple factual question | Direct answer or single WebSearch |
| Single-file code review | `/dev-review` with specific file |
| Known solution implementation | `/structured-dev-cycle` |
| Topic with < 3 comparison dimensions | Single Explore agent |

**Pre-execution check**: If the query can be answered with < 3 sources, skip 10-team research.

## Pre-flight Guards

Before executing the 10-team research workflow, the agent MUST run these checks. Research is a high-cost operation — these guards prevent wasteful execution regardless of the active model inventory.

### Guard Levels

| Level | Meaning | Action |
|-------|---------|--------|
| PASS | No issues detected | Proceed with research |
| INFO | Minor suggestion | Log note, proceed |
| WARN | Potentially wasteful | Show warning with cost estimate, ask confirmation |
| GATE | Wrong tool — use simpler alternative | Block execution, suggest alternative |

### Guard 1: Query Complexity Assessment

**Level**: GATE or PASS

**Check**: Assess if the query requires multi-team research

```
# Simple factual questions → GATE
indicators_simple:
  - Query is < 10 words
  - Query asks "what is", "how to", "when was" (factual)
  - Query has a single definitive answer
  - Can be answered from a single documentation source

# Complex research questions → PASS
indicators_complex:
  - Query involves comparison of 3+ alternatives
  - Query requires analysis across multiple dimensions
  - Query mentions "compare", "evaluate", "analyze", "research"
  - Query references a repository or ecosystem for deep analysis
```

**Action (GATE)**: `[Pre-flight] GATE: Query appears to be a simple factual question. Use a direct answer or one search instead. A 10-team research run would be wasteful. Override with /research --force if intended.`

### Guard 2: Single-File Review Detection

**Level**: GATE

**Check**: If the query references a single file for review

```
# Detection
- Query mentions a specific file path (e.g., src/main.go)
- Query asks to "review" or "analyze" a single file
- No broader context requested
```

**Action**: `[Pre-flight] GATE: For single-file review, use /dev-review {file} instead. Research is for multi-source analysis.`

### Guard 3: Known Solution Detection

**Level**: INFO

**Check**: If the query is about implementing a known solution

```
# Detection
keywords: implement, build, create, add feature, 구현, 만들어
# AND the solution approach is well-known (not requiring research)
```

**Action**: `[Pre-flight] INFO: If the implementation approach is already known, consider /structured-dev-cycle instead of research. Proceeding with research.`

### Guard 4: Context Budget Check

**Level**: WARN

**Check**: Estimate context impact of 10-team research

```bash
# Check current context usage from statusline data
CONTEXT_FILE="/tmp/.codex-context-$PPID"
if [ -f "$CONTEXT_FILE" ]; then
  context_pct=$(cat "$CONTEXT_FILE")
  if [ "$context_pct" -gt 40 ]; then
    # WARN — research will consume significant additional context
  fi
fi
```

**Action**: `[Pre-flight] WARN: Context usage at {pct}%. 10-team research typically adds 30-40% context. Consider /compact before proceeding, or results may be truncated.`

> **File-absent branch (#1466)**: `$CONTEXT_FILE`가 존재하지 않으면 입력이 측정 불가하다 — `PASS (context budget unmeasured — file absent)`로 보고하고 WARN을 내지 않는다. 파일을 읽지 않고 WARN 상태를 특성화하지 않는다(R020 Read-Before-Characterize). WARN은 파일이 존재하고 `context_pct > 40`일 때만 emit한다.

### Display Format

```
[Pre-flight] research
├── Query complexity: PASS — multi-dimensional comparison detected
├── Single-file review: PASS
├── Known solution: PASS
└── Context budget: WARN — context at 45%, research adds ~35%
Result: PROCEED WITH CAUTION (0 GATE, 1 WARN, 0 INFO)
Cost: runtime-dependent; bounded by 10 teams and the verification-round cap
```

If any GATE: block and suggest alternative. User can override with `--force`.
If any WARN: show warning with cost context, ask user to confirm.
If only PASS/INFO: proceed automatically.

## Architecture — 4 Phases

### Phase 1: Parallel Research (10 teams, batched per R009)

**Step 0**: Pre-flight guards pass (see Pre-flight Guards section)

Teams operate in breadth/depth pairs across 5 domains:

| Pair | Domain | Team | Role | Focus |
|------|--------|------|------|-------|
| 1 | Architecture | T1 | Breadth | Survey, catalog, enumerate structure |
| | | T2 | Depth | Deep-dive patterns, validate assumptions |
| 2 | Security | T3 | Breadth | Vulnerability scan, attack surface enumeration |
| | | T4 | Depth | Exploit validation, risk quantification |
| 3 | Integration | T5 | Breadth | Compatibility mapping, dependency analysis |
| | | T6 | Depth | Effort estimation, value assessment |
| 4 | Comparative | T7 | Breadth | Alternative survey, market landscape |
| | | T8 | Depth | Feature comparison, benchmark data |
| 5 | Innovation | T9 | Breadth | Novel pattern identification, idea extraction |
| | | T10 | Depth | Feasibility validation, adaptation design |

**Batching order** (max 4 concurrent per R009):
```
Batch 1: T1, T2, T3, T4    (Architecture + Security)
Batch 2: T5, T6, T7, T8    (Integration + Comparative)
Batch 3: T9, T10            (Innovation)
```

### Phase 2: Cross-Verification Loop (min 2, max 30 rounds)

#### Codex Availability Check

Before starting verification rounds, check codex availability:

```
Team findings ──→ verifier (`frontier`/`high`) ──→ optional plugin-assisted verification
       │                                              │
       └── Contradiction detected? ── YES ──→ Round N+1
                                      NO  ──→ Consensus reached → Phase 3
```

Each round:
1. **Verifier (`frontier`/`high`)**: Checks logical consistency, identifies gaps, and challenges assumptions
2. **Optional Codex interop**: Use native Claude Code plugin `openai/codex-plugin-cc` only when explicitly installed/requested; otherwise use researcher or RTK-backed local evidence gathering.
3. **Contradiction resolution**: Reconcile divergent findings between teams and verifiers
4. **Convergence check**: All major claims verified with no outstanding contradictions → proceed

Convergence expected by round 3. Hard stop at round 30.

### Phase 3: Synthesis

1. Cross-team gap analysis — identify areas no team covered
2. Unified priority ranking — weight findings by confidence and impact
3. ADOPT / ADAPT / AVOID taxonomy generation

### Phase 4: Output

1. Structured markdown report (see Output Format below)
2. **Artifact persistence**: The Phase 4 synthesis agent (frontier/high) writes the report to:
   ```
   .codex/outputs/sessions/{YYYY-MM-DD}/research-{HHmmss}.md

### Compatibility artifact protocol

Sensitive-path compatibility note: when delegated work touches `.claude/outputs/`, `.claude/**`, or `templates/.claude/**`, keep `.codex/**` artifacts on the normal file-write path. On Claude Code v2.1.121+ with `bypassPermissions`, direct compatibility writes are allowed for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`; on v2.1.126+ broader protected paths are covered. Use `/tmp/<skill>-<timestamp>.md` only as a legacy fallback when the runtime is older or still prompts.

   ```
   With metadata header:
   ```markdown
   ---
   skill: research
   date: {ISO-8601 with timezone}
   query: "{original user query}"
   ---
   ```
   The agent writes the artifact file using a file-write API that creates missing parent directories; do not run any Bash directory-creation pre-step for session outputs (R010 compliance).
   Sensitive-path compatibility note: delegated research agents should keep `.codex/**` artifacts on the normal write path and use `/tmp/research-{timestamp}.md` only as a legacy fallback when an older Claude Code runtime still prompts on compatibility paths.
3. GitHub issue auto-created with findings
4. Action items with effort estimates

## Execution Rules

| Rule | Detail |
|------|--------|
| Max parallel teams | 4 concurrent (R009) |
| Batching | T1-T4 → T5-T8 → T9-T10 |
| Agent Teams gate | If enabled, use for cross-team coordination (R018) |
| Orchestrator only | Main conversation manages all phases (R010) |
| Ecomode | Auto-activate for team result aggregation (R013) |
| Intent display | Show research plan before execution (R015) |

## External Quantitative-Fact Source Tagging

Research teams that collect concrete quantitative claims (benchmark numbers, table values, metrics) via WebFetch must tag them in synthesis/report output as `WebFetch-derived (unverified)` unless independently verified from a primary source such as the PDF/original paper. Multiple teams fetching the same URL can share the same WebFetch cache artifact, so agreement across those fetches is not independent ground-truth. Do not write exact load-bearing numbers into persistent issues/artifacts as fact without primary-source verification or an explicit unverified tag (R020, R023).

## Retrieval-Reasoning Separation

Retrieval and reasoning are distinct cognitive operations that benefit from explicit role separation. Mixing them in a single agent degrades both: retrieval becomes biased by premature conclusions, and reasoning gets polluted by search noise.

### Principle

| Role | Phase | Lane / Effort | Responsibility |
|------|-------|-------|----------------|
| Retriever | Phase 1 | frontier/medium (fast, broad) | Gather, catalog, enumerate — no judgment |
| Reasoner | Phase 2-3 | frontier/high (deep, precise) | Verify, synthesize, judge — no new retrieval |

### Why Separate

- **Retrieval bias**: A reasoning agent searching for evidence tends to confirm existing hypotheses (confirmation bias)
- **Context pollution**: Raw search results mixed with analysis obscure both
- **Cost efficiency**: Retrieval needs speed and breadth (cheaper model); reasoning needs depth (capable model)
- **Debuggability**: When results are wrong, separated roles make it clear whether the problem was bad retrieval or bad reasoning

### Application in Research Workflow

| Phase | Role | Separation Rule |
|-------|------|-----------------|
| Phase 1 (10 teams) | Retriever | Teams gather and catalog only. No ADOPT/AVOID judgments. |
| Phase 2 (Verification) | Reasoner | Verifiers challenge claims using Phase 1 data. No new searches. |
| Phase 3 (Synthesis) | Reasoner | Synthesizer produces taxonomy from verified findings only. |
| Phase 4 (Output) | Reporter | Formats and persists. No new analysis. |

## Model Selection

| Phase | Lane / Effort | Rationale |
|-------|-------|-----------|
| Phase 1 (Research teams) | frontier/medium | Balanced speed/quality for parallel research |
| Phase 2 (frontier/high verification) | frontier/high | Deep reasoning for cross-verification |
| Phase 2 (code verification) | frontier/xhigh | Code-level validation of technical claims |
| Phase 3 (Synthesis) | frontier/high | Complex multi-source reasoning and taxonomy |

## Team Prompt Templates

### Breadth Teams (T1, T3, T5, T7, T9)

```
Role: {domain} breadth analyst
Scope: {topic}

Tasks:
1. Survey the full landscape of {focus area}
2. Catalog all {artifacts/components/alternatives} found
3. Enumerate {structure/surface/compatibility/options/patterns}
4. Produce structured inventory with confidence levels

Output format:
- Inventory table (item | description | confidence)
- Coverage map (what was examined vs what remains)
- Key observations (max 5)
- Questions for depth team
```

### Depth Teams (T2, T4, T6, T8, T10)

```
Role: {domain} depth analyst
Scope: {topic}

Tasks:
1. Deep-dive into {specific patterns/risks/efforts/benchmarks/feasibility}
2. Validate assumptions from breadth analysis (if available)
3. Quantify {quality/risk/effort/performance/value}
4. Produce evidence-backed assessment

Output format:
- Detailed analysis (claim | evidence | confidence)
- Validated/invalidated assumptions
- Quantified metrics where possible
- Risk/opportunity assessment
```

## Verification Loop Detail

```
Round N:
  Input:  All 10 team findings + previous round feedback (if any)
  Step 1: frontier/high reviews each team pair for:
          - Internal consistency (breadth ↔ depth alignment)
          - Cross-domain consistency (security ↔ architecture)
          - Evidence quality (claims without backing)
  Step 2: Optional plugin-assisted validation (only if `openai/codex-plugin-cc` is explicitly installed/requested):
          a. Validate technical claims against code patterns, benchmark reproducibility,
             and dependency resolution.
          b. Parse contradictions → merge with verifier findings.
          c. On unavailable plugin or error: log "[Phase 2] Round {N}: optional interop unavailable — continuing with verifier/researcher results".
  Step 3: Compile contradiction list
          - 0 contradictions → CONVERGED
          - >0 contradictions → feedback to relevant teams → Round N+1
```

## Output Format

```markdown
# Research Report: {topic}

## Executive Summary
{2-3 paragraph overview of findings, key recommendation, confidence level}

## Team Findings

### Architecture (Teams 1-2)
**Breadth**: {inventory summary}
**Depth**: {analysis summary}
**Confidence**: {High/Medium/Low}

### Security (Teams 3-4)
**Breadth**: {attack surface summary}
**Depth**: {risk assessment summary}
**Confidence**: {High/Medium/Low}

### Integration (Teams 5-6)
**Breadth**: {compatibility summary}
**Depth**: {effort/value summary}
**Confidence**: {High/Medium/Low}

### Comparative (Teams 7-8)
**Breadth**: {landscape summary}
**Depth**: {benchmark summary}
**Confidence**: {High/Medium/Low}

### Innovation (Teams 9-10)
**Breadth**: {pattern summary}
**Depth**: {feasibility summary}
**Confidence**: {High/Medium/Low}

## Cross-Verification Results
**Rounds completed**: {N}
**Contradictions found**: {count}
**Resolution**: {summary of how contradictions were resolved}

## Taxonomy

### ADOPT (Safe + High Value)
| Item | Rationale | Confidence |
|------|-----------|------------|

### ADAPT (Valuable but needs modification)
| Item | Required Changes | Effort |
|------|-----------------|--------|

### AVOID (Risk > Value)
| Item | Risk | Alternatives |
|------|------|-------------|

## Action Items
| # | Item | Effort | Priority | Owner |
|---|------|--------|----------|-------|
```

## Post-Research Advisory

After research completion, the orchestrator SHOULD display:

```
[Advisory] Research complete.
├── For complex implementations (10+ files): /structured-dev-cycle
├── For quick planning: EnterPlanMode (plan mode)
└── For simple tasks (< 3 files): proceed directly
```

This advisory is informational only and does not block execution.

## Fallback Behavior

| Scenario | Fallback |
|----------|----------|
| Optional Codex plugin unavailable | researcher plus frontier/high verifier (still min 2 rounds) |
| Agent Teams unavailable | Standard Agent tool with R009 batching |
| Partial team failure | Synthesize from available results, note gaps in report |
| GitHub issue creation fails | Output report to conversation only |

## Display Format

Before execution:
```
[Research Plan] {topic}
├── Phase 1: 10 teams (3 batches × 4/4/2)
├── Phase 2: Cross-verification (2-5 rounds, verifier + code evidence)
├── Phase 3: Synthesis (frontier/high)
└── Phase 4: Report + GitHub issue

Estimated: {time} | Teams: 10 | Routing: researcher/medium → verifier/high → code evidence
Stopping: max 30 verification rounds, convergence at 0 contradictions
Cost: runtime-dependent; bounded by team and round limits
Execute? [Y/n]
```

Progress:
```
[Research Progress] Phase 1 — Batch 2/3
├── T1-T4: ✓ Complete
├── T5-T8: → Running
└── T9-T10: ○ Pending
```

## Teams Mode

When running inside an Agent Teams member (not via Skill tool), the research workflow operates identically but with these adaptations:

### How It Works

The orchestrator reads this SKILL.md and includes the research instructions directly in the Teams member's prompt. The member then:

1. Executes Phase 1-4 autonomously using its own Agent tool access
2. Spawns research teams as sub-agents (Teams members CAN spawn sub-agents)
3. Delivers results via `SendMessage` to the team lead instead of returning to orchestrator

### Prompt Embedding Pattern

```
# When spawning a Teams member for research:
Agent(
  name: "researcher-1",
  team_name: "my-team",
  prompt: """
  You are a research agent. Follow the research skill workflow below:
  {contents of research/SKILL.md}

  Topic: {user's research topic}
  Deliver results via SendMessage to team lead when complete.
  """
)
```

### Differences from Orchestrator Mode

| Aspect | Orchestrator Mode | Teams Mode |
|--------|------------------|------------|
| Invocation | `Skill(research)` | Prompt embedding |
| Result delivery | Return to main conversation | `SendMessage` to team lead |
| Artifact persistence | Teams member writes artifact | Same |
| GitHub issue creation | Orchestrator handles | Teams member handles directly |
| Phase management | Orchestrator manages phases | Member manages phases autonomously |

### Constraints

- Each Teams member running research still respects R009 (max 4 concurrent sub-agents)
- Batching order remains: T1-T4 → T5-T8 → T9-T10
- Cost shape is identical to orchestrator mode and depends on the active OMX model inventory
- Multiple Teams members running research simultaneously will multiply costs proportionally

## Integration

| Rule | Integration |
|------|-------------|
| R009 | Max 4 parallel teams; batch in groups of 4/4/2 |
| R010 | Orchestrator manages all phases; teams are subagents |
| R013 | Ecomode auto-activates for 10-team aggregation |
| R015 | Display research plan with team breakdown before execution |
| R018 | Agent Teams for cross-team coordination if enabled |
| dag-orchestration | Phase sequencing follows DAG pattern |
| result-aggregation | Team results formatted per aggregation skill |
| multi-model-verification | Phase 2 uses multi-model verification pattern |

**Claude compatibility `Agent` calls only (R010 “Delegated Permission Ownership”)**: Pass `mode: "bypassPermissions"` when the active Claude session uses bypass permissions. Native Codex `spawn_agent` has no `mode` parameter; use the installed `agent_type` and active Codex runtime permissions instead.
