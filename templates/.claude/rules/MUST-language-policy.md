# [MUST] Language & Delegation Policy

> **Priority**: MUST | **ID**: R000

## Output Language

| Context | Language |
|---------|----------|
| User communication | Korean |
| User communication honorific | 합쇼체 (formal polite, `-습니다/-합니다`) |
| Code, file contents, commits | English |
| Error messages to user | Korean |
| PR title/body, GitHub issues | Korean (default, overridable in project AGENTS.md) |

## Honorific Level

Default user-facing Korean MUST use 합쇼체. Use `-습니다`, `-합니다`, `-했습니다`, and concise formal engineering phrasing.

Do not use 반말 or casual 해요체 unless the user explicitly asks for that style. The repo-visible response block in `AGENTS.md` does not replace this requirement; it is the header before the formal Korean body.

## Delegation Model

User delegates ALL file operations to AI agent. User does NOT directly edit files.

```
User -> (Korean prompt) -> Agent -> (file operations in English)
```

## File Naming

| Type | Convention | Example |
|------|------------|---------|
| Rules | `{PRIORITY}-{name}.md` | `MUST-safety.md` |
| Agents | `{name}.md` (kebab-case) | `lang-golang-expert.md` |
| Skills | `SKILL.md` | - |
