# Agents Reference

Reference snapshot for the oh-my-customcodex agent catalog. The live shipped surface evolves over time; use this page as a category guide, not a canonical count source.

## Overview

| Category | Representative Scope | Purpose |
|----------|-------|---------|
| Orchestrator | Routing / coordination layer | Coordinate and manage other agents |
| Manager | System management and automation | System management and automation |
| System | Core system functionality | Core system functionality |
| SW Engineer/Frontend | Frontend specialists | Frontend development |
| SW Engineer/Backend | Backend specialists | Backend development |
| SW Engineer/Language | Language-specific expertise | Language-specific expertise |
| SW Engineer/Tooling | Build tools and optimization | Build tools and optimization |
| SW Engineer/Database | Database expertise | Database expertise |
| SW Architect | Architecture and documentation | Architecture and documentation |
| Infra Engineer | Infrastructure and DevOps | Infrastructure and DevOps |
| QA Team | Quality assurance roles | Quality assurance |

## Orchestrator Agents

Orchestrators coordinate other agents and manage complex workflows.

### planner

**Role**: Master orchestrator for complex multi-step tasks.

- Plans and decomposes large tasks
- Coordinates multiple agents
- Tracks progress and dependencies

### secretary

**Role**: Task coordination and agent delegation.

- Routes requests to appropriate agents
- Manages agent lifecycle
- Aggregates results from multiple agents

### dev-lead

**Role**: Development team coordination.

- Coordinates SW engineer agents
- Manages code review workflows
- Oversees implementation tasks

### qa-lead

**Role**: QA team coordination.

- Coordinates QA agents
- Manages testing workflows
- Ensures quality standards

## Manager Agents

Managers handle system-level operations and automation.

### mgr-creator

**Role**: Create new agents, skills, and rules.

- Generates agent scaffolding
- Validates structure and metadata
- Updates registries

### mgr-updater

**Role**: Update agents from external sources.

- Checks for updates
- Syncs with remote templates
- Manages versioning

### mgr-supplier

**Role**: Audit and verify dependencies.

- Validates skill references
- Checks for broken links
- Reports dependency issues

### mgr-gitnerd

**Role**: Git operations and workflow automation.

- Manages branches and commits
- Handles merge operations
- Automates git workflows

### mgr-sauron

**Role**: System-wide monitoring and oversight.

- Monitors agent activities
- Tracks resource usage
- Reports system health

## System Agents

System agents provide core functionality.

### sys-memory-keeper

**Role**: Manage session memory and context.

- Saves session context
- Recalls relevant memories
- Handles context persistence

### sys-naggy

**Role**: Task reminders and TODO management.

- Tracks TODO items
- Sends reminders
- Manages task priorities

## SW Engineer Agents - Frontend

### fe-vercel-agent

**Role**: Vercel and Next.js development.

- React best practices
- Next.js patterns
- Vercel deployment

### fe-vuejs-agent

**Role**: Vue.js development.

- Vue 3 composition API
- Vuex/Pinia state management
- Vue ecosystem

### fe-svelte-agent

**Role**: Svelte development.

- Svelte components
- SvelteKit applications
- Svelte stores

## SW Engineer Agents - Backend

### be-fastapi-expert

**Role**: FastAPI development.

- Python async APIs
- Pydantic models
- FastAPI patterns

### be-springboot-expert

**Role**: Spring Boot development.

- Java/Kotlin Spring apps
- Spring ecosystem
- Enterprise patterns

### be-go-backend-expert

**Role**: Go backend development.

- Go web services
- Go concurrency
- Go ecosystem

### be-express-expert

**Role**: Express.js development.

- Node.js APIs
- Express middleware
- JavaScript backend

### be-nestjs-expert

**Role**: NestJS development.

- TypeScript backend
- NestJS modules
- Enterprise Node.js

## SW Engineer Agents - Language

### lang-golang-expert

**Role**: Go language expertise.

- Go idioms and patterns
- Go tooling
- Go best practices

### lang-python-expert

**Role**: Python language expertise.

- Python patterns
- Python tooling
- Python best practices

### lang-rust-expert

**Role**: Rust language expertise.

- Rust ownership model
- Rust patterns
- Rust ecosystem

### lang-kotlin-expert

**Role**: Kotlin language expertise.

- Kotlin idioms
- Kotlin/JVM
- Kotlin multiplatform

### lang-typescript-expert

**Role**: TypeScript language expertise.

- TypeScript patterns
- Type system
- TypeScript tooling

### lang-java21-expert

**Role**: Java 21 language expertise.

- Modern Java features
- Java patterns
- JVM ecosystem

## SW Engineer Agents - Tooling

### tool-npm-expert

**Role**: npm and package management.

- Package.json management
- npm scripts
- Dependency management

### tool-optimizer

**Role**: Performance optimization.

- Code optimization
- Build optimization
- Runtime performance

### tool-bun-expert

**Role**: Bun runtime expertise.

- Bun APIs
- Bun tooling
- Bun ecosystem

## SW Engineer Agents - Database

### db-supabase-expert

**Role**: Supabase backend and database.

- Supabase APIs
- PostgreSQL database
- Supabase auth and storage

## SW Architect Agents

### arch-documenter

**Role**: Documentation creation and maintenance.

- Technical writing
- API documentation
- Architecture docs

### arch-speckit-agent

**Role**: Specification and design documents.

- OpenAPI specs
- System design
- Technical specs

## Infra Engineer Agents

### infra-docker-expert

**Role**: Docker and containerization.

- Dockerfile optimization
- Docker Compose
- Container orchestration

### infra-aws-expert

**Role**: AWS cloud services.

- AWS architecture
- AWS services
- Cloud deployment

## QA Team Agents

### qa-planner

**Role**: Test planning and strategy.

- Test plans
- Coverage analysis
- Risk assessment

### qa-writer

**Role**: Test case creation.

- Test scenarios
- Test data
- Test documentation

### qa-engineer

**Role**: Test implementation and execution.

- Test automation
- Test frameworks
- Bug reporting

## Tutor Agents

### tutor-go

**Role**: Go language learning and tutorials.

- Interactive Go lessons
- Exercise guidance
- Concept explanations
- Practice problems

## Agent Structure

Each agent follows this structure:

```
agents/{category}/{agent-name}/
├── AGENT.md       # Role and capabilities
├── index.yaml     # Metadata and configuration
└── refs/          # Links to skills and guides
```

## Using Agents

Agents are automatically selected based on intent detection, or you can explicitly invoke them:

```
@lang-golang-expert review this code
@be-fastapi-expert create a new endpoint
@infra-docker-expert optimize the Dockerfile
```

See [Customization](/guide/customization) for creating your own agents.
