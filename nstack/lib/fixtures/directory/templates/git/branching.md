# Branching strategy

Use short-lived branches and merge through pull requests. Keep `main` releasable.

## Branch name templates

```text
feat/<short-description>
fix/<short-description>
refactor/<short-description>
docs/<short-description>
test/<short-description>
chore/<short-description>
release/<version>
```

Examples:

```text
feat/linear-service
fix/empty-config
release/v1.2.0
```

## Rules

- Use lowercase kebab-case descriptions.
- Link the issue in the pull request; branch names do not include issue numbers.
- Rebase or update from `main` before requesting review.
- Delete merged branches.
- Do not commit directly to `main` unless the repository explicitly permits it.
- Protect `main` with required reviews and passing CI in the hosting provider.
