# External Interop Guidance

The packaged multi-provider exec skills have been retired. For Codex interoperability, use the official Claude Code plugin `openai/codex-plugin-cc` only when it is explicitly installed and requested.

## Current Paths

| Need | Preferred path | Notes |
|------|----------------|-------|
| Codex interop | `openai/codex-plugin-cc` | Official plugin path; opt-in only. |
| Token-optimized local command output | `rtk-exec` | Existing RTK proxy remains supported. |
| Research or independent review | `researcher`, expert agents, or `roundtable-debate` | Prefer in-repo agent workflows unless plugin interop is requested. |

Do not auto-delegate to retired provider wrapper skills. Keep expert agents responsible for reviewing any plugin-assisted output.
