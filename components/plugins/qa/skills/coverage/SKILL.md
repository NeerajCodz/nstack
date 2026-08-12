---
description: Analyze test coverage gaps and suggest tests to improve coverage.
---

Analyze test coverage for: $ARGUMENTS

Analyze:
1. Run existing test suite and collect coverage
2. Identify untested code paths
3. Identify untested edge cases
4. Check for missing error scenario tests
5. Assess test quality (not just quantity)
6. Find flaky or brittle tests
7. Check mock/stub appropriateness
8. Identify missing integration tests

Return:
- Coverage summary (line, branch, function)
- Critical gaps (untested error handling, auth paths, edge cases)
- Prioritized list of tests to add
- Suggested test implementations
- Commands to run coverage
