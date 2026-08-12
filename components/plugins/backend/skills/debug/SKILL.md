---
description: Diagnose backend issues — crashes, slow endpoints, memory leaks, and connection problems.
---

Help debug a backend issue.

Problem: $ARGUMENTS

Investigate:
1. Reproduce the issue description
2. Check logs and error traces
3. Identify root cause (code path, config, dependency, infrastructure)
4. Check for recent changes that may have introduced the issue
5. Analyze database queries if relevant
6. Check connection pools, timeouts, resource limits
7. Review error handling paths

Return:
- Root cause analysis
- Evidence (log lines, code paths, config values)
- Fix recommendation
- Prevention measures
- Tests to add
