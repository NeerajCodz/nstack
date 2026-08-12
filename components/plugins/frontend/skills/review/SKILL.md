---
description: Review frontend code for correctness, accessibility, performance, and maintainability.
---

You are reviewing frontend code.

Target: $ARGUMENTS

Check:
1. Component structure and reusability
2. State management patterns
3. Event handling correctness
4. Accessibility (ARIA, keyboard nav, screen reader)
5. Responsive design
6. CSS/styling consistency
7. Performance (unnecessary re-renders, large bundles, missing lazy loading)
8. Error boundaries and fallback UI
9. Type safety
10. Test coverage

Return:
- Blocking issues (bugs, accessibility violations, broken UX)
- Non-blocking suggestions
- Suggested patches
- Tests to add
