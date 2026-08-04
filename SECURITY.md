# Security policy

Loam is pre-release software. Until the first public release, there is no supported stable line. After publication, security fixes target the latest published release; older prereleases may be asked to upgrade rather than receive a backport.

## Reporting a vulnerability

<!-- loam-release-blocker: private-security-route -->

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, or pilot scorecard. Send it through the maintainers' existing private project channel and include the affected Loam version, impact, minimal reproduction, and any known workaround.

Before the first public release, maintainers must configure a durable private reporting route (preferably GitHub Private Vulnerability Reporting in the canonical repository) and replace the sentence above with its exact instructions. The release-readiness checklist treats this as a blocker; this repository currently has no remote from which a truthful public URL can be derived.

Please allow the maintainers time to confirm receipt and coordinate remediation before public disclosure. Never include production credentials, customer data, or proprietary fleet documents in a report; use a reduced fixture.
