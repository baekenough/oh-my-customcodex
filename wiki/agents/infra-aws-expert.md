---
title: infra-aws-expert
type: agent
updated: 2026-06-14
sources:
  - .codex/agents/infra-aws-expert.md
related:
  - [[infra-docker-expert]]
  - [[mgr-gitnerd]]
---

# infra-aws-expert

Expert AWS cloud architect for Well-Architected Framework design, infrastructure as code (CloudFormation/CDK/Terraform), VPC networking, IAM security, and cost optimization.

## Overview

`infra-aws-expert` designs and implements scalable, secure, cost-effective AWS infrastructure following the AWS Well-Architected Framework (five pillars: operational excellence, security, reliability, performance efficiency, cost optimization). Key capabilities include IaC with CloudFormation, CDK, and Terraform; VPC/subnet/security group configuration; compute services (EC2, ECS, Lambda); IAM and KMS security hardening; and cost optimization recommendations.

Uses `aws-best-practices` skill and `guides/aws/`. Memory is `user`-scoped for cross-project AWS knowledge retention. The agent now documents optional AWS MCP Server integration: live AWS documentation lookup is preferred when configured, while `call_aws` is treated as a high-privilege execution path that requires delegation to this agent, an explicit R010/R001 scope boundary, and per-invocation approval for writes/deletes.

## Key Details

- **Model**: sonnet
- **Domain**: devops
- **Tools**: Read, Write, Edit, Grep, Glob, Bash
- **Skills**: `aws-best-practices`
- **Memory**: user (cross-project AWS knowledge)
- **Effort**: high
- **Optional MCP**: `aws-mcp` for live AWS docs and IAM-scoped API execution; default remains offline IaC/design guidance

## Relationships

- **Depends on**: `aws-best-practices` skill, `guides/aws/`; optionally `aws-mcp` when user-installed
- **Used by**: R010 delegation table (AWS infrastructure), `secretary-routing` (infra tasks)
- **See also**: [[infra-docker-expert]] (container workloads on ECS/EKS), [[mgr-gitnerd]] (CI/CD pipelines)

## Sources

- `.codex/agents/infra-aws-expert.md` — agent definition
