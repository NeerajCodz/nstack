---
description: Audit dependencies for license compliance, maintenance status, and supply chain risks.
---

Audit project dependencies for supply chain risks.

Target: $ARGUMENTS

Audit:
1. License compatibility (GPL, AGPL, proprietary conflicts)
2. Maintenance status (last commit, open issues, bus factor)
3. Download counts and community trust
4. Known supply chain attacks (event-stream, ua-parser-js pattern)
5. Dependency depth and complexity
6. Lock file pinning
7. Integrity hash verification
8. Private registry usage

Return:
- License conflicts
- Unmaintained or at-risk dependencies
- Overly permissive version ranges
- Recommended alternatives
- Supply chain hardening steps
