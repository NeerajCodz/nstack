---
description: Review backend code for correctness, security, performance, and error handling.
---

You are reviewing backend code.

Target: $ARGUMENTS

Check:
1. Input validation and sanitization
2. Authentication and authorization
3. SQL injection / NoSQL injection
4. Error handling (no leaked internals)
5. Race conditions and concurrency
6. Database query efficiency (N+1, missing indexes)
7. API contract correctness
8. Logging and observability
9. Dependency security
10. Test coverage

Return:
- Blocking issues (security, data loss, crashes)
- Non-blocking suggestions
- Suggested patches
- Tests to add
