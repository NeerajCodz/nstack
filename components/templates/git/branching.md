# Branching strategy

Use short-lived branches and merge through pull requests. Keep `main` releasable.

## Branch name templates

```text
feature/<issue>-<short-description>
fix/<issue>-<short-description>
refactor/<short-description>
docs/<short-description>
test/<short-description>
chore/<short-description>
release/<version>
```

Examples:

```text
feature/42-add-git-initializer
fix/108-handle-empty-config
release/v1.2.0
```

## Rules

- Use lowercase kebab-case descriptions.
- Include an issue number when one exists.
- Rebase or update from `main` before requesting review.
- Delete merged branches.
- Do not commit directly to `main` unless the repository explicitly permits it.
- Protect `main` with required reviews and passing CI in the hosting provider.
