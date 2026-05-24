---
name: post-release-followup
description: Analyze release workflow findings and recommend follow-up actions — execute immediately or register as issues
scope: harness
user-invocable: false
effort: medium
---

# Post-Release Follow-up

## Purpose

After PR creation in the auto-dev release workflow, collect unaddressed findings and present actionable follow-up recommendations. Genuine defects and process gaps are registered as GitHub issues automatically. Only code-changing immediate-action items require user confirmation.

## Workflow

### 1. Collect Follow-up Candidates

Gather unfinished work from multiple sources:

**Source A — Remaining open issues**:
- Run: `gh issue list --label verify-done --state open --json number,title,labels`
- These are triaged issues NOT included in the current release

**Source B — Deep-verify findings**:
- Read the latest deep-verify output from `.codex/outputs/sessions/{today}/`

### Compatibility artifact protocol

Sensitive-path compatibility note: when delegated work touches `.claude/outputs/`, `.claude/**`, or `templates/.claude/**`, keep `.codex/**` artifacts on the normal file-write path. On Claude Code v2.1.121+ with `bypassPermissions`, direct compatibility writes are allowed for `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`; on v2.1.126+ broader protected paths are covered. Use `/tmp/<skill>-<timestamp>.md` only as a legacy fallback when the runtime is older or still prompts.

- Extract any MEDIUM or LOW severity findings that were flagged but not fixed

**Source C — Triage deferred items**:
- Read the latest professor-triage output from `.codex/outputs/sessions/{today}/`
- Extract items explicitly marked as deferred or P3

**Source D — TODO markers in changed files**:
- Run: `git diff develop...HEAD --name-only` to get changed files
- Search changed files for `TODO`, `FIXME`, `HACK` markers added in this release

**Source E — PR review feedback**:
- Run: `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments` and `gh api repos/{owner}/{repo}/issues/{pr_number}/comments`
- Parse omc_pr_analyzer bot comments (Senior Architect, Project Colleague, Professor Synthesis)
- Extract findings categorized as Critical, High, Medium
- Identify: required fixes, recommended improvements, structural concerns

### 2. Deduplicate and Categorize

Remove duplicates (same issue referenced from multiple sources). Categorize:

| Category | Criteria | Default Action |
|----------|----------|----------------|
| **즉시 실행** | P1/P2 잔여 이슈, MEDIUM+ 검증 발견사항, Critical/High PR 리뷰 발견사항 | 즉시 실행 |
| **이슈 등록** | P3 이슈, LOW 검증 발견사항, 새 TODO, Medium PR 리뷰 발견사항 | 이슈로 등록 |
| **참고** | 이미 추적 중인 이슈, 외관 관련 메모 | 건너뛰기 |

### Auto-Register Genuine Defects (no-ask)

Before presenting the summary to the user, auto-register every "이슈 등록" item that is a genuine defect or process gap. No user confirmation is required for these.

Auto-register if any condition applies:
- Genuine defect: bug, regression, broken behavior, or incorrect output observed during verification
- Process gap: workflow hole, missing guard, or coverage gap surfaced by deep-verify or triage
- Coverage gap: missing test, documentation, or automation for a known scenario

Do not auto-register pure cosmetic/style preferences or subjective notes. When ambiguous, lean toward registering; missing a genuine defect costs a future session.

Use `gh issue create --repo baekenough/oh-my-customcodex` with `professor` plus a priority label. Default auto-registered items to `P3`; escalate to `P2` for MEDIUM+ severity.

### 3. Present to User

Auto-register genuine defects first. Then display follow-up summary showing what was already registered and what still needs a decision:

```
[Follow-up] {n}개 후속 작업 발견

━━━ 자동 등록 완료 ({count}개) ━━━
  ✓ #{issue_number} — {description} (이미 등록됨)

━━━ 즉시 실행 추천 ({count}개) ━━━
  1. {description} — 출처: {source}
  2. {description} — 출처: {source}

━━━ 참고 사항 ({count}개) ━━━
  3. {description} — 이미 #{issue_number}로 추적 중

즉시 실행 항목 선택:
  [A] 추천대로 실행 (즉시 실행 항목 모두 실행)
  [B] 개별 선택 (항목별로 질문)
  [C] 건너뛰기
```

Use AskUserQuestion (or equivalent user prompt) only if there are "즉시 실행" items. If there are none, skip the prompt and complete automatically.

### 4. Process User Choice

**Option A (추천대로)**:
- "Immediate" items → delegate to appropriate specialist agents for execution
- Trackable defect/process-gap items were already auto-registered
- "Informational" items → skip

**Option B (개별 선택)**:
- For each immediate item, ask: `[{n}] {description} — 실행(E) / 건너뛰기(S)?`
- Process each per user choice

**Option C (건너뛰기)**:
- Skip all follow-up actions
- Complete workflow

### 5. Report

```
[Follow-up Complete]
├── 즉시 실행: {n}개 완료
├── 이슈 등록: {n}개 (#{numbers})
├── 건너뛰기: {n}개
└── 총 처리: {total}개
```

## Issue Creation Template

For auto-registered genuine defects / process gaps:

```bash
gh issue create \
  --repo baekenough/oh-my-customcodex \
  --title "{간결한 설명}" \
  --body "## 출처\n\nv{version} 릴리즈 워크플로우에서 자동 등록.\n\n## 컨텍스트\n\n{triage/verify에서의 상세 컨텍스트}\n\n## 권장 조치\n\n{권장 사항}" \
  --label "professor"
```

Add priority label (`P1`, `P2`, `P3`) based on categorization. Default for auto-registered items: `P3`; escalate to `P2` for MEDIUM+ severity.

## Notes

- This skill runs in the main conversation context (via workflow skill step)
- Genuine defect/process gap items are auto-registered as issues without user confirmation
- Only "즉시 실행" code-changing items require user confirmation
- All file modifications delegated to specialist subagents per R010
- Issue creation uses `gh` CLI directly (read-only operation pattern)
- If no follow-up candidates found, report "No follow-up actions needed" and complete
- PR review feedback is available shortly after PR creation — the omc_pr_analyzer bot comments automatically
