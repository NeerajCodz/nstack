---
description: Security review — auth, injection, secrets, XSS, CSRF, and OWASP Top 10.
---

You are performing a security review.

Target: $ARGUMENTS

Check OWASP Top 10:
1. Broken Access Control
2. Cryptographic Failures
3. Injection (SQL, NoSQL, Command, LDAP)
4. Insecure Design
5. Security Misconfiguration
6. Vulnerable Components
7. Authentication Failures
8. Software and Data Integrity
9. Logging and Monitoring Gaps
10. SSRF

Also check:
- Hardcoded secrets and API keys
- XSS (stored, reflected, DOM-based)
- CSRF protection
- File upload handling
- Rate limiting
- Input validation

Return:
- Critical findings (exploitable now)
- High findings (likely exploitable)
- Medium findings (defense in depth)
- Low findings (best practice)
- Suggested fixes with code
- Tests to verify fixes
