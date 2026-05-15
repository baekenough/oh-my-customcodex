# templates/

> **oh-my-customcodex distribution directory**
>
> Source files copied or transformed when `omcustomcodex init` installs the harness into a project.

## Purpose

`templates/` is the packaged distribution snapshot for oh-my-customcodex.

The installer maps the Claude-compatible template tree into the Codex-native runtime layout:

```text
oh-my-customcodex source repo
  templates/
    .claude/                  # compatibility template source
    guides/                   # reference documentation
    AGENTS.md.en              # Codex entry template
    AGENTS.md.ko

installed project
  .codex/                     # Codex-native agents, rules, hooks, contexts, ontology
  .agents/skills/             # installed runtime skills
  guides/                     # reference documentation
  AGENTS.md                   # project entrypoint
```

The repository keeps `.codex/**` as the authoring surface. `templates/.claude/**` remains a compatibility source that the installer maps into the target Codex layout.

## Main README Relationship

| Document | Audience | Purpose |
|----------|----------|---------|
| [`/README.md`](../README.md) | Users of the npm package | Project overview, install command, philosophy |
| `templates/README.md` | Maintainers | Distribution layout, component counts, sync checks |

## Directory Structure

```text
templates/
+-- README.md                         # this file
+-- AGENTS.md.en                      # Codex entry template, English
+-- AGENTS.md.ko                      # Codex entry template, Korean
+-- CLAUDE.md*                        # Claude compatibility entry templates
+-- manifest.json                     # packaged component metadata
+-- workflows/                        # project-level pipeline definitions
+-- .claude/
|   +-- agents/                       # agent definitions (49 files)
|   +-- skills/                       # skill modules (119 SKILL.md files)
|   +-- rules/                        # global rules (22 files)
|   +-- hooks/                        # hook registry and scripts (38 scripts)
|   +-- contexts/                     # context files
|   +-- ontology/                     # ontology and routing metadata
|   +-- schemas/                      # tool input schemas
+-- guides/                           # reference docs (48 topics)
```

## Components

The counts below should stay aligned with `templates/manifest.json`, README component headings, and CI template validation.

### Agents (49)

`templates/.claude/agents/*.md`

Flat agent definition files. During Codex installation these land under `.codex/agents/`.

### Skills (119)

`templates/.claude/skills/*/SKILL.md`

Reusable workflow and reference skill modules. During Codex installation these land under `.agents/skills/`.

### Rules (22)

`templates/.claude/rules/*.md`

Global agent behavior rules. During Codex installation these land under `.codex/rules/`.

### Guides (48)

`templates/guides/*/`

Reference documentation directories copied to installed projects as `guides/`.

### Hooks (38)

`templates/.claude/hooks/scripts/*.sh`

Lifecycle hook scripts copied into `.codex/hooks/scripts/`.

## Local Verification

Run the checks below before publishing a template-affecting change:

```bash
bash .github/scripts/verify-version-sync.sh
bun test tests/unit/core/template-validation.test.ts
```

The CI template-sync job also verifies source/template counts for agents, skills, rules, guides, hook scripts, hook matchers, schemas, and skill scripts.

## Maintainer Notes

When adding or removing an agent, skill, rule, guide, hook, or workflow:

1. Update the source surface under `.codex/**`, `.agents/skills/**`, `guides/**`, or `workflows/**`.
2. Mirror packaged content under `templates/**` according to the provider mapping.
3. Update `templates/manifest.json` and visible documentation counts.
4. Add or update a regression test when the drift could recur.
