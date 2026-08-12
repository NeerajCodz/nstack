---
description: Validate API design — REST conventions, versioning, error formats, pagination, and consistency.
---

Review API design for correctness and consistency.

Target: $ARGUMENTS

Check:
1. REST conventions (resource naming, HTTP methods, status codes)
2. Request/response schema consistency
3. Error response format (RFC 7807 or project standard)
4. Pagination strategy (cursor vs offset)
5. Versioning approach
6. Rate limiting headers
7. CORS configuration
8. Authentication scheme consistency
9. Idempotency for mutations
10. Documentation completeness (OpenAPI/GraphQL schema)

Return:
- Design violations
- Inconsistencies across endpoints
- Suggested improvements
- Migration path if breaking changes needed
