---
name: dev-lead-routing
description: Routes development tasks to the correct language or framework expert agent. Use when user requests code review, implementation, refactoring, or debugging.
scope: core
user-invocable: false
context: fork
---

# Dev Lead Routing

## Sensitive-Path Delegation

Sensitive-path compatibility note: if this skill delegates work that touches `.claude/**`, `.claude/outputs/**`, `templates/.claude/**`, or read-only measurements of those paths, keep `.codex/**` edits on the normal Codex path. On Claude Code v2.1.121+ with `bypassPermissions`, direct writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` are allowed; on v2.1.126+ that extends to broader protected paths. Only use `/tmp/{skill}-{timestamp}.md` as a legacy fallback when the target runtime is older or still prompts.

## Engineers

| Type | Agents |
|------|--------|
| Language | lang-golang-expert, lang-python-expert, lang-rust-expert, lang-kotlin-expert, lang-typescript-expert, lang-java21-expert |
| Frontend | fe-vercel-agent, fe-vuejs-agent, fe-svelte-agent, fe-flutter-agent, fe-design-expert |
| Backend | be-fastapi-expert, be-springboot-expert, be-go-backend-expert, be-nestjs-expert, be-express-expert, be-django-expert |
| Tooling | tool-npm-expert, tool-optimizer, tool-bun-expert |
| Database | db-supabase-expert, db-postgres-expert, db-redis-expert, db-alembic-expert |
| Architect | arch-documenter, arch-speckit-agent |
| Security | sec-codeql-expert |
| Infra | infra-docker-expert, infra-aws-expert |
| Slack | slack-cli-expert |

## File Extension Mapping

| Extension | Agent |
|-----------|-------|
| `.go` | lang-golang-expert |
| `.py` | lang-python-expert |
| `.rs` | lang-rust-expert |
| `.kt`, `.kts` | lang-kotlin-expert |
| `.ts`, `.tsx` | lang-typescript-expert |
| `.java` | lang-java21-expert |
| `.js/.jsx` (React) | fe-vercel-agent |
| `.vue` | fe-vuejs-agent |
| `.svelte` | fe-svelte-agent |
| `.dart`, `pubspec.yaml` | fe-flutter-agent |
| `.sql` (PG) | db-postgres-expert |
| `.sql` (Supabase) | db-supabase-expert |
| `alembic.ini`, `alembic/versions/*.py` | db-alembic-expert |
| `Dockerfile`, `*.dockerfile` | infra-docker-expert |
| `*.tf`, `*.tfvars` | infra-aws-expert |
| `*.yaml`, `*.yml` (CloudFormation) | infra-aws-expert |

## Keyword Mapping

| Keywords | Agent |
|----------|-------|
| go, golang | lang-golang-expert |
| python, py | lang-python-expert |
| rust | lang-rust-expert |
| kotlin | lang-kotlin-expert |
| typescript, ts | lang-typescript-expert |
| java | lang-java21-expert |
| react, next.js, vercel | fe-vercel-agent |
| vue | fe-vuejs-agent |
| svelte | fe-svelte-agent |
| flutter, dart, riverpod, bloc, widget | fe-flutter-agent |
| design, typography, color, motion, ux writing, ui design, "design system", "design review", impeccable | fe-design-expert |
| fastapi | be-fastapi-expert |
| django | be-django-expert |
| spring, springboot | be-springboot-expert |
| nestjs | be-nestjs-expert |
| express | be-express-expert |
| npm | tool-npm-expert |
| optimize, bundle | tool-optimizer |
| bun | tool-bun-expert |
| postgres, postgresql, psql, pg_stat | db-postgres-expert |
| redis, cache, pub/sub, sorted set | db-redis-expert |
| supabase, rls, edge function | db-supabase-expert |
| alembic, migration, db revision, db upgrade, db downgrade | db-alembic-expert |
| docker, dockerfile, container, compose | infra-docker-expert |
| aws, cloudformation, vpc, iam, s3, lambda, cdk, terraform | infra-aws-expert |
| security, codeql, cve, vulnerability, sarif, sast, security audit | sec-codeql-expert |
| architecture, adr, openapi, swagger, diagram | arch-documenter |
| spec, specification, tdd, requirements | arch-speckit-agent |
| slack, slack-cli, slack app, slack deploy, slack trigger, slack datastore | slack-cli-expert |

## Model Selection

| Task | Model |
|------|-------|
| Architecture analysis | opus |
| Code review/implementation | sonnet |
| Quick validation/search | haiku |

## Routing Decision (Priority Order)

Before selecting an expert agent, evaluate in this order:

### Step 1: Agent Teams Eligibility (R018)
Check if Agent Teams is available (`OMCODEX_AGENT_TEAMS=1` or TeamCreate/SendMessage tools present).

| Scenario | Preferred |
|----------|-----------|
| Single-language review | Task Tool |
| Multi-language code review (3+) | Agent Teams |
| Code review + fix cycle | Agent Teams |
| Cross-layer debugging (FE + BE + DB) | Agent Teams |
| Simple file search/validation | Task Tool |

### Step 2: External Interop Guidance (Implementation Tasks)
For **new file creation**, **boilerplate**, or **test code generation**:

1. Use the selected expert agent as the default implementation path.
2. If the native Claude Code plugin `openai/codex-plugin-cc` is explicitly installed and requested, it may provide Codex interop for scaffolding before expert review.
3. If RTK is available (`RTK=available` in env status), optionally wrap expert output through `rtk-exec` to reduce token consumption by 60-90%:
   - Display: `[RTK Proxy] Token optimization active via rtk-exec`
   - RTK acts as a transparent proxy — no change to expert selection
4. Otherwise display `[External CLI] Not requested — proceeding with {expert} directly` and use the expert directly.

**Suitable for optional plugin interop**: New file creation, boilerplate, scaffolding, test code
**Unsuitable**: Existing code modification, architecture decisions, bug fixes

### Step 3: Expert Agent Selection
Route to appropriate language/framework expert based on file extension and keyword mapping.

> **Permission Mode**: When spawning agents, pass `mode: "bypassPermissions"` in the Agent tool call if the session uses bypassPermissions. Without explicit mode, CC defaults to `acceptEdits`.

### Step 4: Ontology-RAG Enrichment (R019)

If `get_agent_for_task` MCP tool is available, call it with the original query and inject `suggested_skills` into the agent prompt. Skip silently on failure.

### Step 5: Soul Injection (R006)

If the selected agent has `soul: true` in frontmatter, read and prepend `.codex/agents/souls/{agent-name}.soul.md` content to the prompt. Skip silently if file doesn't exist.

## Routing Rules

Multi-language: detect all languages, route to parallel experts (max 4). Single-language: route to matching expert. Cross-layer (frontend + backend): multiple experts in parallel.

## No Match Fallback

When file extension or keyword doesn't match any existing agent:

```
User Input → No matching development agent
  ↓
Detect: File extension (.rb, .swift, .php, etc.) or language keyword
  ↓
Delegate to mgr-creator with context:
  domain: detected language/framework
  type: sw-engineer
  keywords: extracted from user input
  file_patterns: detected extensions
  skills: auto-discover from .codex/skills/
  guides: auto-discover from templates/guides/
```

**Examples of dynamic creation triggers:**
- Unrecognized file extension (e.g., `.rb` → Ruby expert, `.swift` → Swift expert)
- New framework keyword (e.g., "Flutter 앱 리뷰해줘", "Rails API 만들어줘")
- Language detected but no specialist exists

Not user-invocable. Auto-triggered on development intent.
