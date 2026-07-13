# Getting Started

This guide will help you install and set up oh-my-customcodex in your project.

## Prerequisites

- **Node.js** 20.17+/22.13+/23.5+
- **Codex CLI / OMX environment** installed and configured

## Installation

### Global Installation (Recommended)

Install oh-my-customcodex globally to use it across all your projects:

```bash
npm install -g oh-my-customcodex
```

Or with other package managers:

```bash
# Using yarn
yarn global add oh-my-customcodex

# Using pnpm
pnpm add -g oh-my-customcodex

# Using bun
bun add -g oh-my-customcodex
```

### Verify Installation

```bash
omcustomcodex --version
```

## Initialize Your Project

Navigate to your project directory and run:

```bash
cd your-project
omcustomcodex init
```

This creates the following structure:

```
your-project/
├── AGENTS.md              # Entry point for Codex + OMX
├── .codex/
│   ├── rules/             # Global rules (MUST, SHOULD, MAY)
│   ├── hooks/             # Hook scripts
│   ├── contexts/          # Context files
│   ├── agents/            # Agent definitions (flat .md files)
│   └── skills/            # Skill definitions
└── guides/                # Reference documentation
```

## Language Options

Initialize with Korean language support:

```bash
omcustomcodex init --lang ko
```

## Backup Existing Installation

If you already have an agent system and want to preserve it:

```bash
omcustomcodex init --backup
```

This creates a backup of your existing runtime directory before initializing.

## Verify Installation

Run the doctor command to check that everything is set up correctly:

```bash
omcustomcodex doctor
```

If issues are found, you can auto-fix common problems:

```bash
omcustomcodex doctor --fix
```

## What's Next?

- Learn about [CLI Commands](/guide/commands) for managing your agent system
- Explore [Customization](/guide/customization) to tailor agents to your needs
- Browse the [Agents Reference](/reference/agents) to see all available agents

## Updating

Keep your agent system up to date:

```bash
omcustomcodex update
```

This updates all agents, skills, and rules to the latest versions while preserving your customizations.
