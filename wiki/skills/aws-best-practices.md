---
title: AWS Best Practices
type: skill
updated: 2026-06-14
sources:
  - .codex/skills/aws-best-practices/SKILL.md
related:
  - [[infra-aws-expert]]
  - [[docker-best-practices]]
---

# AWS Best Practices

AWS patterns from Well-Architected Framework for cloud infrastructure.

## Overview

Reference patterns for AWS infrastructure following the Well-Architected Framework's five pillars: operational excellence, security, reliability, performance efficiency, and cost optimization. Covers IAM, VPC design, S3, Lambda, ECS/EKS, RDS, CloudWatch, and CDK/CloudFormation patterns. Used by `infra-aws-expert` when designing or reviewing AWS infrastructure.

The skill is explicitly the offline core: it remains usable without credentials or network access. When the optional AWS MCP Server is installed, live `search_documentation` / `read_documentation` results complement this static guidance for current API syntax, service limits, and best practices.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Effort**: not specified
- **Live-doc complement**: optional `aws-mcp` read-only documentation tools; R001 forbids auto-installation

## Relationships

- **Used by agents**: [[infra-aws-expert]]
- **Related skills**: [[docker-best-practices]]
- **See also**: guides/aws-best-practices/

## Sources

- `.codex/skills/aws-best-practices/SKILL.md` — skill definition
