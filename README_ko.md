<div align="center">
  <img src="assets/banner.webp" alt="oh-my-customcodex banner" width="800" />
</div>

# oh-my-customcodex

> **AI 에이전트 스택. 설정이 아닌 컴파일.**

[![npm version](https://img.shields.io/npm/v/oh-my-customcodex.svg)](https://www.npmjs.com/package/oh-my-customcodex)
[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0/)
[![CI](https://github.com/baekenough/oh-my-customcodex/actions/workflows/ci.yml/badge.svg)](https://github.com/baekenough/oh-my-customcodex/actions/workflows/ci.yml)
[![Security Audit](https://github.com/baekenough/oh-my-customcodex/actions/workflows/security-audit.yml/badge.svg)](https://github.com/baekenough/oh-my-customcodex/actions/workflows/security-audit.yml)

**[English Documentation](./README.md)**

50개 에이전트. 122개 스킬. 23개 규칙. 명령어 하나.

> **v0.1.7** — token-efficiency-audit 스킬, 토큰 효율 3계층 가이드, cc-token-saver/CLI flags cross-reference 추가

```bash
npm install -g oh-my-customcodex && cd your-project && omcustomcodex init
```

`omcustomcodex init`은 언어, 프레임워크, 팀 모드를 묻는 인터랙티브 마법사를 실행합니다 (@clack/prompts 기반).

---

## v0.1.7의 새로운 기능

| 기능 | 설명 |
|------|------|
| **`$token-efficiency-audit`** | Claude/Codex 설정을 점검하고 토큰 낭비를 줄이기 위한 감사/적용 워크플로우 |
| **Token Efficiency Layers guide** | 플러그인, 런타임, 설정 레이어를 분리한 토큰 효율 최적화 가이드 |
| **cc-token-saver cross-reference** | 기존 플러그인 가이드에서 Layer 3 설정 기반 최적화로 바로 이동 가능 |
| **CLI flags cross-reference** | Claude Code CLI 플래그 문서에서 토큰 효율 가이드로 바로 이동 가능 |

---

## 철학

oh-my-customcodex는 두 가지 아이디어 위에 세워졌습니다.

**1. 에이전트 시스템은 설정하는 게 아니라 컴파일한다.**

| 컴파일 개념 | oh-my-customcodex |
|------------|-----------------|
| 소스 리포 authoring | `.codex/skills/` — 이 패키지 자체가 유지하는 스킬 정의 |
| 설치 런타임 스킬 | `.agents/skills/` — 관리 대상 프로젝트에 배포되는 재사용 가능한 지식과 워크플로우 |
| 빌드 결과물 | `.codex/agents/` — 스킬을 조합한 실행 가능한 전문가 |
| 컴파일러 | `mgr-sauron` (R017) — 구조 검증과 정합성 보장 |
| 하네스 정책 | `.codex/rules/*.md` — `AGENTS.md`가 명시적으로 참조하는 행동 제약 |
| 링커 | Routing skills — 에이전트를 작업에 연결 |
| 표준 라이브러리 | `guides/` — 공유 레퍼런스 문서 |

스킬이 소스이고, 에이전트가 빌드 결과물이며, Sauron이 빌드를 검증합니다. 이 분리 덕분에 스킬은 에이전트와 독립적으로 진화하고, 에이전트는 갱신된 스킬로 언제든 재컴파일할 수 있습니다.

<p align="center">
  <img src="assets/diagrams/05-compilation-metaphor.png" alt="Compilation Metaphor" width="700" />
</p>

**2. 안 되면 되게 한다.**

작업에 맞는 전문가가 없을 때, oh-my-customcodex는 실패하지 않습니다. 만듭니다.

```
사용자: "이 Terraform 모듈을 리뷰해줘"
  → 라우팅: terraform 전문가 없음
  → mgr-creator가 탐색: infra-aws-expert 스킬 + docker-best-practices 가이드
  → 생성: infra-terraform-expert.md
  → 즉시 리뷰 실행
  → 에이전트는 이후 재사용을 위해 영속 저장
```

이것은 폴백이 아닙니다. 설계입니다. 시스템은 부족한 전문성을 빌드 문제로 취급합니다 — 적합한 스킬을 찾고, 새 에이전트를 컴파일하고, 실행합니다.

---

## 동작 방식

### 오케스트레이션

메인 대화가 싱글톤 오케스트레이터입니다 (R010). 파일을 직접 작성하지 않습니다. 모든 작업은 라우팅 스킬을 통해 전문 에이전트에 위임됩니다.

```
사용자 (자연어)
  → 라우팅 스킬 (의도 감지, 신뢰도 산출)
    → 전문 에이전트 (격리 실행)
      → 오케스트레이터에 결과 반환
        → 사용자에게 응답
```

4개의 라우팅 스킬이 전체 도메인을 커버합니다:

<p align="center">
  <img src="assets/diagrams/01-system-architecture.png" alt="System Architecture" width="700" />
</p>

| 라우팅 스킬 | 라우팅 대상 |
|------------|-----------|
| secretary-routing | 매니저 에이전트 (mgr-*), 시스템 에이전트 (sys-*) |
| dev-lead-routing | 언어, 백엔드, 프론트엔드, 툴링, DB, 인프라, 아키텍처 에이전트 |
| de-lead-routing | 데이터 엔지니어링 에이전트 (de-*) |
| qa-lead-routing | QA 팀 (qa-planner, qa-writer, qa-engineer) |

### 모델 및 추론 강도 선택

에이전트는 provider 전용 모델 별칭 대신 Codex/OMX capability lane과
`model_reasoning_effort`를 사용합니다. 실제 모델 ID는 실행 시점에
`OMX_DEFAULT_FRONTIER_MODEL`, `OMX_DEFAULT_SPARK_MODEL` 또는 활성 Codex/OMX
설정에서 해석합니다. lane이 설정되지 않으면 생성 TOML은 `model`을 생략해
낡은 ID를 고정하지 않고 현재 Codex 모델을 상속합니다.

| Lane | 실행 시점 소스 | 대표 작업 |
|------|----------------|-----------|
| `frontier` | `OMX_DEFAULT_FRONTIER_MODEL` 또는 활성 Codex 모델 | 아키텍처, 구현, 검증 |
| `spark` | `OMX_DEFAULT_SPARK_MODEL` (legacy `OMX_SPARK_MODEL`) | 검색, triage, 가벼운 검증 |
| `inherit` | 현재 Codex 세션 | 호출자의 모델을 따라야 하는 역할 |

lane과 별도로 `model_reasoning_effort`(`none`, `minimal`, `low`, `medium`,
`high`, `xhigh`, `ultra`, `max`; 모델 지원 범위에 따름)를 지정합니다.
Reasoning sandwich 패턴은 분석·검증의 effort를 높이고 기계적 구현에는 충분한
최소 effort를 사용합니다.

### 병렬 실행

독립 작업은 병렬로 실행됩니다 (R009). 리포 하네스 soft/default 디스패치
크기는 4, hard cap은 5이며 Codex/OMX native capacity는 런타임에서
결정되어 사용 가능한 슬롯이 더 적을 수 있습니다:

```
Agent(lang-golang-expert):frontier/high  ┐
Agent(lang-python-expert):frontier/high  ├─ 하나의 메시지에서 동시 스폰
Agent(qa-engineer):frontier/medium       │
Agent(arch-documenter):spark/low         ┘
```

---

## 에이전트 (50개)

| 카테고리 | 수 | 에이전트 |
|---------|-----|---------|
| 언어 | 6 | lang-golang, lang-python, lang-rust, lang-kotlin, lang-typescript, lang-java21 |
| 백엔드 | 6 | be-fastapi, be-springboot, be-go-backend, be-express, be-nestjs, be-django |
| 프론트엔드 | 5 | fe-vercel, fe-vuejs, fe-svelte, fe-flutter, fe-design |
| 데이터 엔지니어링 | 6 | de-airflow, de-dbt, de-spark, de-kafka, de-snowflake, de-pipeline |
| 데이터베이스 | 4 | db-supabase, db-postgres, db-redis, db-alembic |
| 툴링 | 3 | tool-npm, tool-optimizer, tool-bun |
| 아키텍처 | 2 | arch-documenter, arch-speckit |
| 인프라 | 2 | infra-docker, infra-aws |
| QA | 3 | qa-planner, qa-writer, qa-engineer |
| 보안 | 1 | sec-codeql |
| 매니저 | 6 | mgr-creator, mgr-updater, mgr-supplier, mgr-gitnerd, mgr-sauron, mgr-claude-code-bible |
| 시스템 | 3 | sys-memory-keeper, sys-naggy, tracker-checkpoint |
| 보조 | 2 | slack-cli, wiki-curator |
| 추론 검토 | 1 | scholastic |

각 에이전트는 YAML 프론트매터에 도구, 모델, 메모리 스코프, 한계를 선언합니다. 에이전트 유형별 도구 예산이 정확도를 위해 강제됩니다.

---

## 스킬 (122개)

| 카테고리 | 수 | 포함 |
|---------|-----|------|
| 베스트 프랙티스 | 24 | Go, Python, TypeScript, Kotlin, Rust, React, FastAPI, Spring Boot, Django, Flutter, Docker, AWS, Postgres, Redis, Kafka, dbt, Spark, Snowflake, Airflow, pipeline-architecture-patterns, alembic 외 |
| 라우팅 | 4 | secretary, dev-lead, de-lead, qa-lead |
| 워크플로우 | 14 | structured-dev-cycle, deep-plan, research, evaluator-optimizer, dag-orchestration, worker-reviewer-pipeline, reasoning-sandwich, pipeline, fsd 외 |
| 개발 | 10 | dev-review, dev-refactor, analysis, create-agent, intent-detection, web-design-guidelines, omcodex:takeover, skill-extractor, pre-generation-arch-check, idea |
| 운영 | 10 | update-docs, audit-agents, sauron-watch, monitoring-setup, token-efficiency-audit, fix-refs, release-notes 외 |
| 메모리 | 3 | memory-save, memory-recall, memory-management |
| 패키지 | 3 | npm-publish, npm-version, npm-audit |
| 최적화 | 3 | optimize-analyze, optimize-bundle, optimize-report |
| 보안 | 3 | adversarial-review, cve-triage, jinja2-prompts |
| 기타 | 10 | claude-native, gitlab, visual-ralph, visual-verdict, vercel-deploy, skills-sh-search, result-aggregation, writing-clearly-and-concisely 외 |

스킬은 3-tier scope 시스템을 사용합니다: `core` (범용), `harness` (에이전트/스킬 관리), `package` (프로젝트 특화).

`context:fork` 상한이 12로 확장되었습니다 (현재 11개 활성). 라우팅 스킬은 기본적으로 전문 에이전트/RTK 경로를 사용하며, `openai/codex-plugin-cc`가 명시적으로 설치 및 요청된 경우에만 Codex 상호운용을 사용합니다.

---

## 스킬 호출

설치된 스킬은 `$skill-name`으로 명시적으로 호출합니다. 현재 Codex 세션에서
사용 가능한 스킬은 네이티브 `/skills` 명령으로 탐색합니다. 아래 항목은 사용자
정의 슬래시 커맨드가 아니라 스킬 호출 예시입니다.

### 개발

| 커맨드 | 기능 |
|--------|------|
| `$dev-review` | 베스트 프랙티스 기반 코드 리뷰 |
| `$dev-refactor` | 구조와 패턴 개선 리팩토링 |
| `$structured-dev-cycle` | 6단계 개발: plan → verify → implement → verify → compound → done |
| `$deep-plan` | 연구 검증 기반 계획 수립 |
| `$research` | 10-team 병렬 분석 및 교차 검증 |
| `$sdd-dev` | Spec-Driven Development 워크플로우 |
| `$ambiguity-gate` | 사전 라우팅 모호성 분석 |
| `$pre-generation-arch-check` | 구현 전 아키텍처 위험 점검 |
| `$adversarial-review` | 공격자 관점 보안 코드 리뷰 |
| `$omcustomcodex:goal` | 구체 목표를 계획, 실행, 검증까지 유지 |
| `$omcustomcodex:fsd` | `$pipeline auto-dev` + `$homework`를 eligible 이슈가 소진될 때까지 반복 |
| `$pipeline` | YAML 파이프라인 실행 |
| `$pipeline resume` | 중단된 파이프라인 재개 |

### 에이전트 관리

| 커맨드 | 기능 |
|--------|------|
| `$omcustomcodex:analysis` | 프로젝트 분석, 에이전트·스킬 자동 구성 |
| `$omcustomcodex:create-agent` | 새 에이전트 생성 |
| `$omcustomcodex:takeover` | 기존 에이전트/스킬에서 canonical spec 추출 |
| `$idea` | 자연어 아이디어를 구조화된 이슈 스펙으로 변환 |
| `$omcustomcodex:audit-agents` | 에이전트 의존성 감사 |
| `$omcustomcodex:update-docs` | 프로젝트 구조와 문서 동기화 |
| `$omcustomcodex:sauron-watch` | 전체 구조 검증 (5+3 라운드) |
| `$omcustomcodex:feedback` | 피드백을 GitHub 이슈로 등록 |

### Web UI

| 커맨드 | 기능 |
|--------|------|
| `$omcustomcodex:web` | 내장 Web UI 제어 (start, stop, status, open) |

### 패키지 & 릴리즈

| 커맨드 | 기능 |
|--------|------|
| `$omcustomcodex:npm-publish` | npm 배포 |
| `$omcustomcodex:npm-version` | 시맨틱 버전 관리 |
| `$omcustomcodex:npm-audit` | 의존성 보안 감사 |
| `$omcustomcodex-release-notes` | git 히스토리 기반 릴리즈 노트 생성 |

### 메모리 & 시스템

| 커맨드 | 기능 |
|--------|------|
| `$memory-save` | 세션 컨텍스트 저장 |
| `$memory-recall` | 메모리 검색 및 리콜 |
| `$omcustomcodex:monitoring-setup` | OTel 모니터링 토글 |
| `$token-efficiency-audit` | 토큰 효율 설정 감사 및 조정 |
| `$omcustomcodex:lists` | 전체 커맨드 표시 |
| `$omcustomcodex:status` | 시스템 상태 확인 |

---

## 하네스 행동 정책 (23개)

이 Markdown 정책은 `AGENTS.md` 지침 계층을 통해 로드되며 Codex native
Starlark 명령 규칙이 아닙니다.

| 우선순위 | 수 | 목적 |
|---------|-----|------|
| **MUST** | 14 | 안전, 권한, 에이전트 설계, 식별, 오케스트레이션, 검증, 완료 검증, 집행 정책 |
| **SHOULD** | 8 | 상호작용, 오류 처리, 메모리, HUD, ecomode, ontology 라우팅, 검증 래더, 위키 동기화 |
| **MAY** | 1 | 최적화 |

핵심 규칙: R010 (오케스트레이터 직접 쓰기 금지), R009 (병렬 실행 의무), R017 (푸시 전 sauron 검증), R020 (완료 선언 전 검증 의무), R021 (어드바이저리 우선 집행 모델).

---

## 보안

`omcustomcodex init`은 검증된 어드바이저리 훅만 Codex native 프로젝트
레지스트리인 `.codex/hooks.json`으로 컴파일합니다:

| 훅 | 트리거 | 동작 |
|----|--------|------|
| secret-filter | Bash PostToolUse | AWS 키, API 토큰, 개인 키, bearer 토큰 감지 |
| schema-validator | Bash, apply_patch PreToolUse | 도구 입력 검증 및 위험 패턴 플래그 |
| destructive-git-guard | Bash PreToolUse | Git 상태를 폐기할 수 있는 명령 사전 경고 |
| file-change-validator | apply_patch PostToolUse | 설정 파일 및 lockfile 변경 알림 |

모든 보안 훅은 어드바이저리입니다 (exit 0). 경고만 하고 차단하지 않습니다.

관리 대상 훅을 병합할 때 기존 custom/OMX 핸들러와 순서를 보존합니다.
먼저 프로젝트의 `.codex/` 설정 레이어를 신뢰한 뒤, init/update 후
`/hooks`에서 정확한 명령 훅 정의를 검토하고 승인하세요. Codex는 신뢰하지
않은 프로젝트 훅을 건너뛰며 `omcustomcodex`는 훅 해시를 자동 승인하지
않습니다.
`--dangerously-bypass-hook-trust`는 격리되고 사전 검토된 자동화 테스트용이며
일반 온보딩에 사용하지 않습니다.

---

## CLI

```bash
omcustomcodex init                  # 인터랙티브 마법사로 초기화 (언어, 프레임워크, 팀 모드)
omcustomcodex init --lang ko        # 한국어로 초기화
omcustomcodex init --team           # 팀 모드 활성화
omcustomcodex init --from-snapshot  # 사전 구성된 팀 스냅샷에서 설치
omcustomcodex sync                  # .codex/ 상태와 lockfile 간 드리프트 감지
omcustomcodex sync --check          # 변경 없이 드리프트 확인
omcustomcodex sync --export         # 현재 상태를 팀 스냅샷으로 내보내기
omcustomcodex update                # 최신 버전 업데이트
omcustomcodex list                  # 컴포넌트 목록
omcustomcodex doctor                # 설치 상태 검사
omcustomcodex doctor --fix          # 문제 자동 수정
omcustomcodex security              # 보안 이슈 스캔
omcustomcodex projects              # 관리 프로젝트 목록 및 버전 상태
omcustomcodex update --all          # 모든 구버전 프로젝트 일괄 업데이트
omcustomcodex serve                 # 내장 Web UI 시작
omcustomcodex serve-stop            # Web UI 중지
```

---

## 프로젝트 구조

### 관리 대상 프로젝트 런타임

```
your-project/
├── AGENTS.md                   # 진입점
├── .codex/
│   ├── agents/                 # 50개 에이전트 정의
│   ├── rules/                  # 하네스 Markdown 정책; 선택적 native *.rules 실행 정책
│   ├── hooks/                  # 15개 라이프사이클 훅 스크립트
│   ├── schemas/                # 도구 입력 검증 스키마
│   ├── specs/                  # 추출된 canonical spec
│   ├── contexts/               # 4개 공유 컨텍스트 파일
│   └── ontology/               # RAG용 지식 그래프
├── .agents/
│   └── skills/                 # 122개 설치 스킬 모듈
└── guides/                     # 52개 레퍼런스 문서
```

### 소스 리포와 호환성 표면

- 이 저장소 자체는 패키지 authoring용 스킬을 `.codex/skills/`에 유지합니다. 이것은 설치된 프로젝트의 런타임 스킬 경로와 다릅니다.
- 설치된 프로젝트는 관리 대상 스킬을 `.agents/skills/`, 관리 대상 Codex 에이전트를 `.codex/agents/*.toml`에 둡니다.
- 설치된 `.codex/rules/*.md`는 하네스 행동 정책입니다. `AGENTS.md`가 해당 파일을 명시적으로 로드하거나 참조하기 때문에 적용되며, Codex가 이 디렉터리의 Markdown을 네이티브 명령 정책으로 자동 해석하는 것은 아닙니다.
- 네이티브 Codex 명령 실행 정책은 `.codex/rules/*.rules` Starlark 파일을 사용합니다. 이 파일은 셸 명령의 허용·확인·금지를 제어하며 하네스 Markdown 정책과 별개입니다.
- `.codex/agents/*.md` 저장소 정의와 `templates/.claude/agents/*.md` 패키지 정의는 서로 다른 upstream 호환 소스 입력입니다. 전자는 native `model_lane`과 `model_reasoning_effort`를 사용하고 후자는 명시적인 Claude 호환 스키마를 유지합니다. `omcustomcodex`는 두 스키마를 동일한 관리 대상 TOML 런타임 계약으로 컴파일하며, 어느 Markdown 형식도 설치 후 활성 역할은 아닙니다.
- 그 밖의 `templates/.claude/`와 `templates/CLAUDE.md*` 파일은 upstream 호환 템플릿 입력면으로 남아 있으며, 설치 후 활성 Codex 런타임 표면은 아닙니다.
- `.codex/hooks/`에는 관리 대상 스크립트와 명시적인 Claude 호환성 레코드가 있으며, `omcustomcodex`는 검증된 native 하위 집합을 Codex가 탐색하는 `.codex/hooks.json` 프로젝트 레지스트리로 컴파일합니다.
- Custom 및 OMX native 역할은 `.codex/agents/*.toml`에 공존할 수 있으며, `omcustomcodex`는 자체 생성한 관리 대상 TOML 역할을 동기화하면서 이들을 보존합니다.
- 프로젝트 단위 MCP 설정은 `.codex/config.toml`, 관리 프로젝트 레지스트리는 `~/.oh-my-customcodex/projects.json`을 사용합니다.

---

## 외부 도구 통합

RTK는 `omcustomcodex init` 시 자동 설치되어 60-90% 토큰을 절감합니다. 나머지는 선택입니다:

| 도구 | 용도 | 설치 | 상태 |
|------|------|------|------|
| [RTK](https://github.com/rtk-ai/rtk) | CLI 출력 토큰 60-90% 절감 | `omcustomcodex init` 시 자동 설치 | **권장** |
| [Codex CLI](https://github.com/openai/codex) | OpenAI Codex 하이브리드 워크플로우 | `npm i -g @openai/codex` | 선택 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Google Gemini 하이브리드 워크플로우 | `npm i -g @google/gemini-cli` | 선택 |

설치된 도구는 세션 시작 시 **자동 감지**되며 관련 기능이 활성화됩니다. 미설치 시 명령어는 내장 GPT Codex + OMX 기본 경로나 다음 지원 통합 경로로 폴백됩니다.

---

## 개발

```bash
bun install          # 의존성 설치
bun run dev          # 개발 모드
bun test             # 테스트 실행
bun run build        # 프로덕션 빌드
```

요구사항: Node.js 20.17+/22.13+/23.5+, Codex CLI.

### @omcodex/eval-core

v0.38.0에서 추가된 LLM 평가 엔진입니다. 세션/턴/결과를 수집하고 SQLite(Drizzle ORM)에 저장합니다.

```bash
cd packages/eval-core
bun install
bun run cli -- --help
```

---

## 라이선스

이 프로젝트는 **[PolyForm Noncommercial License 1.0.0](LICENSE)** 라이선스를 따릅니다.

**비상업적** 목적(개인 프로젝트, 연구, 교육, 비영리/정부 용도)에 한해 자유롭게 **사용·수정·배포**할 수 있습니다. 본 라이선스에서 **상업적 이용은 허용되지 않습니다**.

상업용 라이선스가 필요하시면 이슈를 열거나 작성자에게 문의해 주세요.

---

<p align="center">
  <strong>전문가가 없으면? 만들고, 지식을 연결하고, 실행한다.</strong>
</p>

<p align="center">
  Made with care by <a href="https://github.com/baekenough">baekenough</a>
</p>
