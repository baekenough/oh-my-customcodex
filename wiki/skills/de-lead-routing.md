---
title: DE Lead Routing
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/de-lead-routing/SKILL.md
related:
  - [[de-airflow-expert]]
  - [[de-dbt-expert]]
  - [[de-spark-expert]]
  - [[de-kafka-expert]]
  - [[de-snowflake-expert]]
  - [[de-pipeline-expert]]
---

# DE Lead Routing

Routes data engineering tasks to the correct DE/pipeline specialist agent.

## Overview

Routing skill for data engineering tasks. Detects the appropriate DE expert based on keywords, file patterns, and technology indicators, then delegates to the matching specialist. Native Codex dispatch uses an installed `agent_type` and active runtime permissions; only a Claude compatibility `Agent` call passes `mode: "bypassPermissions"`, and only when that Claude session uses bypass permissions. Targets Airflow, dbt, Spark, Kafka, Snowflake, and general pipeline experts, with R019 ontology-RAG enrichment.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Context**: fork
- **Permission boundary**: no `mode` on native Codex `spawn_agent`; conditional `bypassPermissions` only on Claude compatibility `Agent`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[secretary-routing]], [[dev-lead-routing]], [[qa-lead-routing]]
- **See also**: [[R010]], [[R015]], [[R019]]

## Sources

- `.codex/skills/de-lead-routing/SKILL.md` — skill definition
