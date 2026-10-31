# Security policy

Loam is pre-release software and has no supported stable line. Security fixes target the latest
published prerelease; users of older prereleases may be asked to upgrade rather than receive a
backport.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, pull request, or discussion. Report it
privately through **GitHub Private Vulnerability Reporting**, which is enabled for this repository:
[open a private report](https://github.com/ybotok/loam/security/advisories/new), or reach the same
form from the repository's **Security** tab under **Advisories**. The report stays visible to you
and the maintainers alone until an advisory is published, so details belong in it rather than in a
public request for contact.

Include the affected Loam version, the impact, a minimal reduced reproduction, and any known
workaround. Leave out credentials, customer data, and proprietary fleet documents: a reduction
against [`examples/docs`](https://github.com/ybotok/loam/tree/main/examples/docs) is worth more
than a real fleet's files, and is the one form of evidence nobody has to redact afterwards.

The private form is the only route that is private. A GitHub issue, pull request or discussion is
public the moment it is opened, and nothing about a form's appearance says otherwise — check that
the page you are on is the advisory form above before typing anything you would not publish.

Please allow the maintainers time to confirm receipt and coordinate remediation before public
disclosure. Never include production credentials, customer data, or proprietary fleet documents in a
report; use a reduced fixture.

## A shared docs repo writes into every reader's agent

This is a property of the design rather than a vulnerability to report. Loam's briefs quote the
docs repo verbatim — intent, requirement bodies, scenarios, model titles — so anyone who can merge a
change there writes into the context of every agent, on every team, that reads it. Loam labels that
text as data in its text views, its workflow protocols, the generated `AGENTS.md` and the MCP
server's instructions, and it does not filter it: it cannot tell an instruction from a requirement.
Treat merge rights on the docs repo as you treat merge rights on code that runs, and require
`CODEOWNERS` review on `services/<svc>/` and `features/` so a spec change passes its owning team
first — [WORKFLOW.md](WORKFLOW.md#driving-it-from-an-agent) has the rules. A Loam surface that
hands an agent authored text without that label is worth a report.
