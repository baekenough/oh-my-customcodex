# CLI Commands

oh-my-customcodex provides a CLI tool (`omcustomcodex`) for managing the child-package runtime templates.

## Overview

| Command | Description |
|---------|-------------|
| `omcustomcodex init` | Initialize agent system |
| `omcustomcodex update` | Update managed components to latest templates |
| `omcustomcodex list` | List installed components |
| `omcustomcodex doctor` | Verify installation health |
| `omcustomcodex security` | Scan hook declarations, referenced executable bodies, configs, and templates |

## init

Initialize the agent system in your current project.

```bash
omcustomcodex init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-l, --lang <language>` | Language for templates (`en` or `ko`). Default: `en` |

### Examples

```bash
# Initialize with default settings
omcustomcodex init

# Initialize with Korean templates
omcustomcodex init --lang ko
```

## update

Update managed components in the current project.

```bash
omcustomcodex update [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would change without writing files |
| `--force` | Force update even if already at latest version |
| `--force-overwrite-all` | Bypass preservation logic (manifest/config preserve rules) |
| `--backup` | Create backup before updating |
| `--agents` | Update only agents |
| `--skills` | Update only skills |
| `--rules` | Update only rules |
| `--guides` | Update only guides |
| `--hooks` | Update only hooks |
| `--contexts` | Update only contexts |

### Examples

```bash
# Update everything
omcustomcodex update

# Preview changes only
omcustomcodex update --dry-run

# Update only agents and skills
omcustomcodex update --agents --skills
```

Hook updates install only the scripts reachable from the compiled native
`.codex/hooks.json` registry: the managed native subset and its advisory
wrapper. During migration, a dormant legacy managed script is removed only
when its bytes still match the packaged source. Modified or unrelated custom
hook files are preserved.

## list

List installed components.

```bash
omcustomcodex list [options] [type]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `type` | One of `agents`, `skills`, `guides`, `rules`, `hooks`, `contexts`, or `all` (default: `all`) |

### Options

| Option | Description |
|--------|-------------|
| `-f, --format <format>` | Output format: `table`, `json`, or `simple` (default: `table`) |
| `--verbose` | Show detailed information |

### Examples

```bash
# List all components
omcustomcodex list

# List only agents
omcustomcodex list agents

# List skills as JSON
omcustomcodex list skills --format json

# List the native registry and executable files reachable from it
omcustomcodex list hooks --format json
```

For native projects, `list hooks` reports the root registry and its active
referenced files. Dormant Claude-compatibility assets are not reported as
active hooks.

## security

Scan hook declarations, directly referenced project-local executable bodies,
configuration files, and template permissions.

```bash
omcustomcodex security
```

Executable scanning is confined to the project's `.codex/hooks/` tree after
realpath resolution. Missing, dynamic, external, or escaping references are
reported conservatively instead of being called safe. The scanner follows the
single `omcustomcodex-hook` marker hop emitted by the managed advisory wrapper;
it does not recursively follow arbitrary commands dispatched later by script
bodies.

## doctor

Check installation health.

```bash
omcustomcodex doctor [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--fix` | Automatically fix issues that can be repaired |

### Examples

```bash
# Run health checks
omcustomcodex doctor

# Auto-fix repairable issues
omcustomcodex doctor --fix
```

## Global Options

| Option | Description |
|--------|-------------|
| `--skip-version-check` | Skip CLI tool pre-flight version checks |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error |
| `2` | Invalid arguments |
