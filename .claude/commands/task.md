---
description: Route work to specialized agents with minimal context overhead.
argument-hint: [task description]
---

# Task Orchestrator

Inspect `TASK.md`.

## Execution Loop

1. **Implementation Phase**:
    - Dispatch `@implementer`.
    - On completion, dispatch `@verifier`.

2. **Validation & Bug Handling**:
    - If `@verifier` outputs `VALIDATION_FAILED`:
        - Read ONLY the `## Active Failures & Blockers` section in `TASK.md`.
        - **Attempt 1 (Local/Obvious Failure)**:
            - Dispatch `@implementer` with the specific failure note from `TASK.md`.
            - Re-run `@verifier`.
        - **Attempt 2+ OR Ambiguous/Subsystem Failure**:
            - Escalate to `@architect` (`claude-opus-5-5`).
            - `@architect` investigates root cause across system boundaries and appends a resolution plan to `docs/plans/<task>-bugfix.md`.
            - Dispatch `@implementer` with `docs/plans/<task>-bugfix.md`.
            - Re-run `@verifier`.

## Context Rule

Never paste full test dumps into agent prompts. Keep failure payloads in `TASK.md` under 25 lines.
