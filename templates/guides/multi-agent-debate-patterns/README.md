# Multi-Agent Debate Patterns

## Pattern Choice

| Pattern | Goal | Use When |
|---------|------|----------|
| `roundtable-debate` | Preserve dissent while reaching a bounded decision | Release gates, design approval, high-risk specs with minority risks |
| `roundtable-debate` | Preserve dissent | Strategy choices, tradeoffs, ambiguous product or architecture decisions |

## Failure Modes

- **Anchoring**: later reviewers inherit the first opinion.
- **Groupthink**: reviewers converge because convergence looks productive.
- **Degeneration of thought**: debate continues without adding new evidence.

## Controls

1. Start with independent parallel analysis.
2. Assign a devil's advocate.
3. Protect minority findings unless explicitly rejected with evidence.
4. Cap debate at two rounds.
5. Switch from debate to evidence gathering when facts are missing.

## Decision Record

Keep the final recommendation, rejected alternatives, and protected dissent together. Future agents should be able to see not only what was chosen, but which minority risk remains live.
