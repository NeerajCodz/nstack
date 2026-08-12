---
description: Scan for known vulnerabilities in dependencies and suggest remediation.
---

Scan dependencies for known vulnerabilities.

Target: $ARGUMENTS

Scan:
1. Run dependency audit (npm audit, pip audit, cargo audit, etc.)
2. Check for outdated dependencies with known CVEs
3. Identify transitive dependency risks
4. Check for abandoned/unmaintained packages
5. Verify lock file integrity
6. Check for typosquatting risks

Return:
- Critical vulnerabilities (fix immediately)
- High vulnerabilities (fix soon)
- Medium vulnerabilities (plan fix)
- Dependency update commands
- Breaking change risks from updates
- Alternative packages if current ones are abandoned
