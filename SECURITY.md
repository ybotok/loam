# Security policy

Loam is pre-release software and has no supported stable line. Security fixes target the latest
published prerelease; users of older prereleases may be asked to upgrade rather than receive a
backport.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, pull request, or discussion. GitHub Private Vulnerability Reporting is the intended durable route, but it is **not
currently confirmed or enabled** for this repository. Do not assume that a GitHub form or link is
private unless it explicitly opens a private vulnerability report.

<!-- loam-release-blocker: private-security-route -->

Until that private route is confirmed, the temporary fallback is to
[open a detail-free issue](https://github.com/ybotok/loam/issues/new) requesting private contact
from a maintainer. Include no vulnerability details, affected component, impact, reproduction, logs,
credentials, customer data, or proprietary fleet documents in the issue. After a maintainer
establishes a private channel, send the affected Loam version, impact, a minimal reduced
reproduction, and any known workaround there.

A tested, durable private reporting route remains a release prerequisite. The release blocker above
must not be removed merely because the temporary public issue fallback exists.

Please allow the maintainers time to confirm receipt and coordinate remediation before public
disclosure. Never include production credentials, customer data, or proprietary fleet documents in a
report; use a reduced fixture.
