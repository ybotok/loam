# Security policy

Loam is pre-release software. Until the first public release, there is no supported stable line. After publication, security fixes target the latest published release; older prereleases may be asked to upgrade rather than receive a backport.

## Reporting a vulnerability

<!-- loam-release-blocker: private-security-route -->

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, or pilot scorecard. Report it privately through GitHub Private Vulnerability Reporting — **[Report a vulnerability](https://github.com/ybotok/loam/security/advisories/new)**, also reachable from the repository's Security tab — and include the affected Loam version, impact, minimal reproduction, and any known workaround.

This marker stays until Private Vulnerability Reporting is switched on for the canonical repository (Settings → Code security → Private vulnerability reporting); until then the link above resolves to nothing and the route is not yet durable.

Please allow the maintainers time to confirm receipt and coordinate remediation before public disclosure. Never include production credentials, customer data, or proprietary fleet documents in a report; use a reduced fixture.
