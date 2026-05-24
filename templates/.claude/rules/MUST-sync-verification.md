# [MUST] Sync Verification Rules

> **Priority**: MUST | **ID**: R017

## Core Rule

After modifying agents, skills, or guides: run full verification before committing AND pushing. Never ask to commit/push before `mgr-sauron:watch` passes.

Every `git push` requires: `mgr-sauron:watch` → all pass → `git push`

## Verification Phases

### Phase 1: Manager Verification (5 rounds)

| Round | Actions |
|-------|---------|
| 1-2 | mgr-supplier:audit, mgr-updater:docs (sync check), fix issues |
| 3-4 | Re-verify mgr-supplier:audit + re-run mgr-updater:docs, fix remaining |
| 5 | Final: all counts match, frontmatter valid, skill refs exist, memory scopes valid, routing patterns updated |

Also run: mgr-claude-code-bible:verify (official spec compliance)

### Phase 2: Deep Review (3 rounds)

| Round | Focus |
|-------|-------|
| 1 | Workflow alignment: routing skills have complete agent mappings |
| 2 | References: no orphans, no circular refs, valid skill/memory refs |
| 3 | Philosophy: R006 separation, R009 parallel, R010 delegation, R007/R008 identification |

### Phase 3: Wiki Sync Verification

| Check | Action |
|-------|--------|
| Missing pages | Source entities without wiki pages → run `/omcustomcodex:wiki` |
| Stale pages | Source modification date newer than wiki `updated` field → run `/omcustomcodex:wiki ingest <path>` |
| Broken cross-refs | Wiki links pointing to non-existent pages → run `/omcustomcodex:wiki lint` |
| wiki/index.yaml accuracy | Wiki index page count and indexed file entries match actual page files |

Wiki verification is also enforced by CI (`.github/workflows/wiki-sync.yml`).

### Structural Migration Verification

Directory restructuring, template flattening, branch-strategy changes, generated-file relocation, and package-surface moves require a clean-checkout migration audit before they are considered complete.

Required checks:

1. Run the relevant verification from a clean checkout or isolated worktree, not only from a developer tree with untracked files.
2. Confirm old paths are no longer referenced by CI, docs validators, template validators, install/init output, and release workflows.
3. Confirm new paths are tracked by git and present in packaged templates or generated output where users will rely on them.
4. Verify allowlists, `.gitignore`, and template sync checks do not hide missing files.
5. Add or update regression tests that fail on the old path assumption.

This section is specifically intended to catch migrations where local untracked files or stale CI path references make a release appear healthy while a clean checkout fails.

### Phase 4: Fix all discovered issues

### Phase 5: Commit via mgr-gitnerd

### Phase 6: Push via mgr-gitnerd (only after sauron passes)

## Self-Check — 6-point commit check + 3-point push check. See full checklist via Read tool.

<!-- DETAIL: Self-Check Before Commit and Push

```
╔══════════════════════════════════════════════════════════════════╗
║  BEFORE COMMITTING, ASK YOURSELF:                                ║
║                                                                   ║
║  1. Did I complete all 5 rounds of manager verification?         ║
║  2. Did I complete all 3 rounds of deep review?                  ║
║  3. Did I fix all discovered issues?                             ║
║  4. Are all counts matching across all sources?                  ║
║  5. Am I delegating to mgr-gitnerd for the commit?               ║
║  6. Are wiki pages in sync with source changes?                  ║
║                                                                   ║
║  If NO to any → wait until verification completes                ║
╚══════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════╗
║  BEFORE PUSHING, ASK YOURSELF:                                   ║
║                                                                   ║
║  1. Did mgr-sauron:watch complete successfully?                  ║
║  2. Were all issues from sauron verification fixed?              ║
║  3. Am I delegating to mgr-gitnerd for the push?                 ║
║                                                                   ║
║  If NO to any → wait until sauron verification passes            ║
║                                                                   ║
║  Sauron verification is required for all pushes.                 ║
╚══════════════════════════════════════════════════════════════════╝
```
-->

## When Required

Any change to: agents, agent frontmatter, skills, guides, routing patterns, rules, wiki pages.

## Quick Verification Commands — agent/skill/guide/wiki counts via ls/find/wc. See commands via Read tool.

<!-- DETAIL: Quick Verification Commands

Key checks: agent count (`ls .codex/agents/*.md | wc -l`), skill count (`find .codex/skills -name "SKILL.md" | wc -l`), guide count (`find guides -mindepth 1 -maxdepth 1 -type d | wc -l`), wiki page count (`find wiki -name "*.md" ! -name "index.md" ! -name "log.md" | wc -l`).

Full verification bash scripts:
```bash
# Agent count check
ls .codex/agents/*.md | wc -l

# Skill count check
find .codex/skills -name "SKILL.md" | wc -l

# Frontmatter validation (check for missing YAML headers)
for f in .codex/agents/*.md; do head -1 "$f" | grep -q "^---" || echo "MISSING FRONTMATTER: $f"; done

# Check for agents with invalid skill references
for f in .codex/agents/*.md; do
  grep "^skills:" -A 10 "$f" | grep "  - " | sed 's/.*- //' | while read skill; do
    [ -f ".codex/skills/$skill/SKILL.md" ] || echo "INVALID SKILL REF in $f: $skill"
  done
done

# Routing skill pattern coverage
grep -c "agent_patterns:" .codex/skills/secretary-routing/SKILL.md
grep -c "agent_patterns:" .codex/skills/dev-lead-routing/SKILL.md
grep -c "agent_patterns:" .codex/skills/qa-lead-routing/SKILL.md

# Memory field validation
for f in .codex/agents/*.md; do
  mem=$(grep "^memory:" "$f" | awk '{print $2}')
  if [ -n "$mem" ] && [ "$mem" != "project" ] && [ "$mem" != "user" ] && [ "$mem" != "local" ]; then
    echo "INVALID MEMORY SCOPE in $f: $mem"
  fi
done

# Hook count check
ls .codex/hooks/*.json 2>/dev/null | wc -l

# Context count check
ls .codex/contexts/*.md 2>/dev/null | wc -l

# Guide count check
find guides -mindepth 1 -maxdepth 1 -type d | wc -l

# Agent name accuracy (compare AGENTS.md table with actual files)
ls .codex/agents/*.md | xargs -I{} basename {} .md | sort > /tmp/actual-agents.txt

# Slash command skill existence
for cmd in $(grep "^| \`/" AGENTS.md | sed 's/.*`\///' | sed 's/`.*//' | sed 's/ .*//')
do
  [ -d ".codex/skills/$cmd" ] || echo "MISSING SKILL: $cmd"
done

# Routing skill completeness check
ls -d .codex/skills/*-routing 2>/dev/null | xargs -I{} basename {} | sort

# Verify routing skill names in AGENTS.md
grep -oP '(secretary|dev-lead|de-lead|qa-lead)-routing' AGENTS.md | sort -u
```
-->
