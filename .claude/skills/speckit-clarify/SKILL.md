---
name: speckit-clarify
description: "Identify and resolve ambiguities in a feature spec. Use after /speckit-specify to review a draft spec for gaps, contradictions, or unclear requirements. Trigger: /speckit-clarify, 'clarify the spec', 'review spec ambiguities'."
---

# SpecKit Clarify

Reviews a draft spec for ambiguities, gaps, and contradictions, then generates clarifying questions.

## Flow

1. Read the spec from `.specify/features/<feature-name>/spec.md`
2. Analyze for:
   - **Ambiguous requirements** — FR/NFR statements that could be interpreted multiple ways
   - **Missing edge cases** — scenarios not covered (error states, concurrent access, empty data)
   - **Contradictions** — requirements that conflict with each other or with existing specs
   - **Undefined terms** — domain concepts used but not explained
   - **Missing data model fields** — schema columns referenced in requirements but not in Section 4
   - **Missing API endpoints** — operations described in requirements but not in Section 5
3. Present findings as a numbered list of questions/issues
4. For each issue, propose a resolution
5. After user confirms resolutions, update both `spec.md` and `spec.zh.md`

## Rules

- Always read the actual codebase to verify claims in the spec
- Cross-reference with other existing specs in `.specify/features/` for consistency
- Don't nitpick formatting — focus on substantive issues
- Group findings by severity: Critical (blocks implementation) > Important > Advisory
