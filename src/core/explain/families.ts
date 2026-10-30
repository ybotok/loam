/**
 * The family registry: `loam explain`'s content for the four code families no
 * fix table anywhere grades — `doctor.*`, `next.*`, `diff.*` and `gate.*`.
 *
 * WHY THIS IS NOT THE DUPLICATION fix-tables.ts FORBIDS. That module's header
 * argues against a second hand-maintained copy of the /loam-check prose, and
 * the argument is right: the tables ship in the binary, test/codes-drift.test.ts
 * holds every emitted finding code against them, and a registry restating them
 * would be free to trail the bytes `loam instructions loam-check` prints. None
 * of that applies here. These 67 codes have no fix-table row in any workflow
 * body — /loam-check grades DOCUMENTS, and these four families grade a
 * repository's wiring (`doctor`), a recommendation (`next`), a change between
 * two refs (`diff`) and a deploy question (`gate`). There is nothing to trail:
 * this registry is not a second copy, it is the only copy. The precedent is the
 * sibling module refusals.ts, a hand-written map that is the sole source for
 * the `ErrorCode` meanings for exactly the same reason — their prose lives in
 * doc comments, which are erased, so there is no runtime constant to read.
 *
 * What that costs, stated rather than hidden: nothing mechanical proves an
 * entry below still matches the message its emitter prints. Every meaning and
 * every fix here was written FROM the emitter — `doctor` findings carry a `fix`
 * field of their own (core/doctor/), a `next` step carries a `statement` and a
 * literal `command` (core/status/), the `DiffCode` union carries a doc comment
 * per member (core/diff/semantic.ts) — and the wording is theirs, not a
 * paraphrase invented here. Two guards catch the two failures that CAN be
 * caught: test/explain.test.ts asserts no code below is also answered by a fix
 * table (the two sources must never be able to disagree), and
 * test/agent-commands-runnable.test.ts parses every backticked `loam …` in this
 * file against the real program, so a fix naming a command loam does not have —
 * or a flag it does not declare — fails at gate time. A two-token span is a
 * NAME rather than an invocation there and is only checked for the command
 * existing, so a fix that means an invocation must carry its arguments.
 *
 * `severityNote` is the EMITTER's own word, not a fix table's parenthetical:
 * `doctor` grades blocker/warning, `diff` and `gate` grade ok/warn/error, and a
 * `next` step is graded not at all — it is a recommendation, so its note is
 * `step`. Where a code's severity depends on what was found (`doctor.docs-locked`,
 * `gate.partners-unknown`) the note says so in prose, the way the tables' own
 * long notes do (`warn here; error at archive plan time`).
 *
 * `openspec.*` and `mapping.*` — 49 codes — are deliberately NOT here, and the
 * reason is in test/explain.test.ts beside their backlog entries: they are the
 * only codes in the vocabulary whose subject is not a loam document at all.
 */

/**
 * One code's answer. Structurally a `FindingEntry` (lookup.ts) minus `scope`,
 * which the family supplies — declared here rather than imported so this module
 * imports nothing at all and the package's file-level graph stays a tree.
 *
 * Every entry below is written on ONE line, however long that line runs, and
 * that is a deliberate concession to a counted limit rather than a style: 65
 * codes at four lines each is 260 lines of punctuation before a word of prose,
 * which does not fit the 400-line file limit — and src/core/explain/ is at its
 * five-file cap, so there is no second file to put the overflow in. The fields
 * stay named for the same reason a tuple was refused: `severityNote`, `meaning`
 * and `fix` say which column is which without counting commas.
 */
export interface FamilyEntry {
  /** The emitter's own severity word, or the prose a conditional one needs. */
  readonly severityNote: string;
  /** What the code is about, in the words the emitter already prints. */
  readonly meaning: string;
  /** What to do — for `next.*`, that the step's own `command` IS the action. */
  readonly fix: string;
}

/** One family: the invocation that emits it, and its codes. */
interface Family {
  /** The scope label, spelled as the fix tables spell theirs — the invocation that grades it. */
  readonly scope: string;
  readonly codes: Readonly<Record<string, FamilyEntry>>;
}

/**
 * `loam doctor` — the preflight. Every finding here already carries a `fix`
 * field in doctor's own report (core/doctor/doctor.ts, config.ts, agents.ts,
 * residue.ts); these rows say the same thing without a repository in front of
 * them, which is the whole difference between a report and a lookup.
 */
const DOCTOR: Family = {
  scope: "loam doctor",
  codes: {
    "doctor.config-missing": { severityNote: "blocker", meaning: "No loam.json at or above the working directory, so nothing says which docs repo this checkout belongs to — every other command refuses with `no-config` until there is one.", fix: "Run `loam init --docs <dir>` in this repository; add `--create` when the docs repo does not exist yet." },
    "doctor.config-invalid": { severityNote: "blocker", meaning: "A loam.json is there and `parseConfig` — the same loader every command uses — refuses it; the finding carries the parser's own words. doctor deliberately has no second validator: the one it used to carry accepted a config the commands rejected, and reported a healthy repo in which nothing could run.", fix: "Repair the file the finding names, or delete it and re-run `loam init`." },
    "doctor.docs-missing": { severityNote: "blocker", meaning: "`docsDir` resolves to something that is missing or is not a directory — the docs repo was never cloned, or the path is wrong.", fix: "Fix `docsDir` in the loam.json the finding names, clone the docs repo to that path, or run `loam init --docs <dir> --create`." },
    "doctor.services-missing": { severityNote: "blocker", meaning: "`docsDir` is a directory and holds no `services/`, so it is some other directory — most often the service repo itself, after a typo in the pointer.", fix: "Point `docsDir` at the shared docs repo, or run `loam init --docs <dir> --create` to scaffold one. Do not scaffold a second source of truth beside the real one." },
    "doctor.docs-absolute": { severityNote: "warning", meaning: "`docsDir` is stored as an absolute path and loam.json is committed, so the pointer names a directory that exists on exactly one machine: it works for whoever ran `loam init` and for nobody who clones the repo afterwards.", fix: "Rewrite `docsDir` as a path relative to the loam.json holding it, such as `../docs`." },
    "doctor.docs-unreadable": { severityNote: "warning", meaning: "The docs repo exists and this process cannot read it, so every command that reads the fleet will fail or report an empty one.", fix: "Grant read access to the directory the finding names — check ownership and mode." },
    "doctor.docs-readonly": { severityNote: "warning", meaning: "The docs repo is readable and not writable: read-only commands work and the writing ones do not.", fix: "Grant write access if you need `loam new`, `loam adopt` or `loam archive`. A read-only checkout is a legitimate state for a reviewer, which is why this is a warning." },
    "doctor.landscape-missing": { severityNote: "warning", meaning: "architecture/landscape.likec4 is missing, and it is the one artifact every cross-service check reads — nothing about who calls whom can be checked without it.", fix: "Create it with one element per service and an edge per call: `loam init --create` writes the empty map, and `loam seed --from fleet.yaml` templates one from stated facts." },
    "doctor.landscape-unreadable": { severityNote: "blocker", meaning: "The landscape file exists and the read itself failed — permissions or an I/O error, carried verbatim in the message.", fix: "Check permissions on the path the finding names." },
    "doctor.landscape-merge-conflict": { severityNote: "blocker", meaning: "The landscape still contains merge conflict markers, named by line. Checked BEFORE the parser on purpose: both sides of a conflict can be syntactically valid LikeC4, so the file sometimes parses and is still two halves of two different maps.", fix: "Resolve the conflict keeping BOTH services' elements and edges — the usual cause is several services adopted into one map in the same week — then re-run `loam doctor`." },
    "doctor.landscape-invalid": { severityNote: "blocker", meaning: "The landscape exists, carries no conflict markers, and does not parse; the message quotes the first parser error with its line and counts the rest.", fix: "Fix the file — every fleet-wide check is blind until it parses." },
    "doctor.likec4-config-missing": { severityNote: "warning", meaning: "The docs repo has no likec4.config.json, so the tree is not a loadable LikeC4 workspace: every service model and feature delta declares its own `specification` block, and a renderer pointed at the repo root merges them and reports every declaration as a duplicate. No loam check reads this file — the repo is only unrenderable, which is why it is a warning.", fix: "Write the project file the finding prints; it scopes the root project to architecture/, so `npx likec4 start` in the docs repo renders the fleet map. Then run `loam subsystem sync`: it writes one create-only likec4.config.json beside every service model, so each model renders from that same root as a project of its own — only a feature delta still renders from its own directory." },
    "doctor.docs-locked": { severityNote: "warning while a live process holds it; blocker when its holder is dead or it names none", meaning: "A `.loam-lock` is present. Held by a running process it is a fact about right now. Held by a process that no longer exists on this host — or unreadable, so no holder can be named at all — nothing is ever going to release it, and every writing command refuses with `docs-busy` forever.", fix: "Wait and re-run while the holder is alive; nothing is read or written while it is held. Delete the lock file the finding names when its holder is dead or unnameable, then run `loam doctor` again for an interrupted commit underneath it." },
    "doctor.commit-unreadable": { severityNote: "blocker", meaning: "A `.loam-commit` journal is present and cannot be read: a commit was interrupted and the one record of which files it had already written is unreadable.", fix: "Hand this to a human — compare the root's files against version control before running any loam command that writes there. Every journaled writer refuses with `commit-interrupted` while it is present." },
    "doctor.commit-interrupted": { severityNote: "blocker", meaning: "A journaled writer — archive, unarchive, rebase, vouch, new, gherkin, or a recording verify — was killed mid-commit. The message names the host, pid and time, and every file or directory move that may be half-done. This is the surface that used to report a healthy repo over half-merged living docs.", fix: "Re-run the command the finding names: it recovers first, under the lock, rolling the staged bytes forward, and refuses rather than guessing if a file has been edited since. An interrupted `loam unarchive` is FINISHED, never undone — the merged text it was replacing is written down nowhere." },
    "doctor.staging-temps": { severityNote: "warning", meaning: "Orphaned `.loam-*.tmp` scratch files from a killed writer, never linked into place — so nothing reads them and nothing depends on them. A journal's own recorded temps are excluded, because those are the durable copy its roll-forward recovery renames in. Litter, not damage.", fix: "The next journaled writer through that root removes its own; delete any that remain. They cost disk and nothing else." },
    "doctor.inventory-unreadable": { severityNote: "warning", meaning: "The config and the docs repo are both fine and enumerating `services/` or `features/` threw, so doctor's fleet counts — and its verdict on the service binding — are about a fleet nobody could read.", fix: "Check that services/ and features/ under the docs repo are readable directories." },
    "doctor.service-unbound": { severityNote: "warning", meaning: "loam.json declares no `service`, so nothing binds this checkout to one governed boundary and the service-repo checks have nothing to run against — `sources.stale`, a recording `loam verify`, `loam gherkin`. Deliberately not emitted inside the docs repo itself, where having no binding is the correct state rather than a gap.", fix: "Run `loam init --docs <dir> --service <id>` here." },
    "doctor.service-unknown": { severityNote: "warning", meaning: "loam.json names a `service` the fleet has no services/<id>/ for — and the fleet WAS read, so this is a claim about a real inventory rather than one nobody could take. Two states raise it: nobody has adopted that service yet, or an active feature INTRODUCES it — its only documents are that feature's specs/<id>/ until the feature archives. doctor's binding line and `currentService.introducedBy` say which; the message names the feature.", fix: "When a feature introduces it there is nothing to adopt — adopting would write services/<id>/ ahead of the merge. Run `loam status <FEAT-id>` for what this repository owes that feature; the warning clears when it archives. Otherwise run `loam adopt --service <id>` to onboard it. Either way, fix `service` in loam.json if it names the wrong service." },
    "doctor.agent-files-missing": { severityNote: "warning", meaning: "Some of the command and skill files this loam lays down for the repo's recorded tools and profile are not here: the repo was initialized by an older loam, or they were deleted. An out-of-date command set costs entry points, never a refusal, which is why it is a warning.", fix: "Re-run `loam init --docs <dir> --tools <ids>` here. It creates absent files, refreshes only pointers whose current bytes still match their recorded digest, preserves every customized file, and keeps this repo's service binding." },
    "doctor.agent-files-stale": { severityNote: "warning", meaning: "Command or skill files that ARE here differ from the body this binary writes and carry no loam stamp, or one older than this binary, so what they instruct an agent with may describe a loam that no longer exists. A file whose only difference is an older stamp is current and not reported; a customized body under a current stamp is not reported either, because the stamp records that somebody reviewed it. Safe refresh is a separate digest check performed by init.", fix: "Re-run `loam init` to refresh a pointer only when its recorded digest still matches. Review a customized file against the current body yourself and update its stamp, or delete it so init can recreate it; your edits always outrank the template." },
    "doctor.agents-md-shadowed": { severityNote: "warning", meaning: "The docs repo's AGENTS.md is there and current, and a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the docs repo or any directory above it does not import it. Claude Code reads AGENTS.md only when none of those three exists in the working directory or above, so a Claude Code session in this repo starts without loam's orientation, while every other host still reads it. A shadow that imports AGENTS.md (`@AGENTS.md`), or is a symlink to it, clears the finding; the host setting that loads both cannot be seen from the files.", fix: "Add the line `@AGENTS.md` to the file the finding names. loam never writes it, because that file is yours. Setting Claude Code's Project instructions to `claude-md-and-agents-md` also works, but only for whoever sets it." },
  },
};

/**
 * `loam status` — both forms print `next[]`, and each entry carries a `code` to
 * branch on, one sentence, and the literal `command` to run. So the "what to
 * do" column is genuinely empty for this whole family: the step IS the action,
 * and each `fix` below names the step's own command rather than inventing a
 * second instruction beside it.
 */
const NEXT_STEPS: Family = {
  scope: "loam status",
  codes: {
    "next.adopt-bound": { severityNote: "step", meaning: "The fleet form's first entry: this repository's loam.json says it is a service the fleet has no services/<id>/ for, so nothing about the boundary you are standing in is written down yet. Ahead of every other service's adoption work, because it is the only step that is about HERE. When a feature in flight INTRODUCES that service, this step is not emitted: there is no code to adopt yet, and that feature's `next.feature` leads instead.", fix: "The step IS the action: run its `command`, `loam adopt --service <id> --json`." },
    "next.author-landscape": { severityNote: "step", meaning: "The first rung of the first-hour ladder, over a fleet with no services and no features: architecture/landscape.likec4 does not exist, or is still the scaffold's untouched map with no service drawn on it.", fix: "The step IS the action: run its `command` — `loam init --create` when the file is absent, `loam seed --from fleet.yaml` when it is the untouched scaffold. loam never guesses who calls whom." },
    "next.bind-service": { severityNote: "step", meaning: "First-hour ladder: no service repository is bound to this fleet yet, so no command can ever run from a service's own checkout.", fix: "The step IS the action: run its `command`, `loam init --docs <path-to-this-docs-repo> --service <service-id> --agent-profile service`, from a service's own repo, and commit the loam.json it writes. The service profile leaves loam-feature and loam-ship, which this docs repo keeps, out of the service checkout." },
    "next.adopt-first": { severityNote: "step", meaning: "First-hour ladder: services/ is empty, so nothing about any service is written down and nothing can be graded against anything.", fix: "The step IS the action: run its `command`, `loam adopt --service <service-id> --json`; the brief it prints walks an agent through writing the baseline docs as draft." },
    "next.adopt": { severityNote: "step", meaning: "One service in the fleet has no spec.md — nothing about it is written down, so no feature can be graded against it — or has one marked `adoption: partial`: `loam archive` wrote it from one feature's slice into a service nobody had adopted, so what the service already did is still unwritten. One entry per such service.", fix: "The step IS the action: run its `command`, `loam adopt --service <id> --json`. For a partial adoption the brief shows spec.md as present — write the baseline around the slice, never replace it — and then delete the `adoption: partial` line, which is the only thing that retires the step." },
    "next.complete-service": { severityNote: "step", meaning: "Adoption does not end at spec.md: a service has one and no model.likec4, the state archive warns about and the fleet gate reports incomplete until something models it.", fix: "The step IS the action: run its `command`, `loam validate --service <id> --json`." },
    "next.vouch": { severityNote: "step", meaning: "A service whose spec.md and model.likec4 are written — adopted, not `adoption: partial` — and that nobody has vouched for yet: no person has read the documents against the code and stamped them, so every reader is trusting an agent's reading. This step keeps `next.fleet-clean` from saying nothing is owed. One entry per service; a spec naming no `sources:` says so, because `loam vouch` refuses without them. Status does not read the fleet map, so it cannot tell whether a service with no openapi.yaml owes one; such a step says so, and `loam list --needs-work` — which does read the map — names the contract first where a caller makes it owed. The human view folds many into one counted line.", fix: "Not an agent's step: its `execution` is a human review. Write the openapi.yaml first if `loam list --needs-work` names it, declare `sources:` in the spec.md frontmatter if the step says none are named, prepare the reading list with `loam vouch --pack --service <id>`, then a person reads it and runs the step's `command`, `loam vouch --service <id>`, from that service's own repository. Never write `status: verified` by hand." },
    "next.revouch": { severityNote: "step", meaning: "A vouched service's spec.md or arch.spec.md changed after the person read it — `content.stale`, computable from the docs repo because it needs nothing but the document. `status: verified` still stands, so every fleet readout says vouched (stale) and this step keeps `next.fleet-clean` from saying nothing is owed. One entry per service, naming the documents that moved.", fix: "Not an agent's step: its `execution` is a human review. Prepare the reading list with `loam vouch --pack --service <id>`, then a person re-reads what moved and runs the step's `command`, `loam vouch --service <id>`, from that service's own repository. Never revert the document or touch `content_digest` to silence it." },
    "next.feature": { severityNote: "step", meaning: "One feature in flight that is not verified yet, with where it stands said in words — docs being written, docs ready with N of M claims answered, blocked — or, when it is blocked by another feature, the features it is waiting on. The fleet form lists every feature before any service's adoption rung. In a service repository whose bound service a feature introduces, the first entry is that feature's, saying so.", fix: "The step IS the action: run its `command`, `loam status <FEAT-id> --json`, for that feature's own next list." },
    "next.archive": { severityNote: "step", meaning: "In the fleet form, a feature that is authored and verified: archive it, and everything queued behind it is released. In a feature's own list it is always the last entry. Archive merges the deltas into the living docs and checks the documents only — never the code or the verification record — so it will not stop you archiving work nobody built; finish the steps above it first.", fix: "The step IS the action: run its `command`, `loam archive <FEAT-id> --dry-run --json`; the dry run writes nothing and lists every file the merge would touch." },
    "next.elided": { severityNote: "step", meaning: "The fleet list is capped, and this says how many steps it left out, counted by code. The list is ordered most-unblocking first, so what was elided is the least urgent — a list nobody reads is not navigation.", fix: "The step IS the action: run its `command`, `loam list --json`, or work down the printed list and run status again." },
    "next.fleet-clean": { severityNote: "step", meaning: "Services exist, nothing is in flight, and nothing is owed. Only that truthful case: over an EMPTY fleet the same sentence was vacuously true, and the first-hour ladder owns that repository now.", fix: "The step IS the action: run its `command`, `loam validate --all --json`, then start the next feature." },
    "next.fleet-gate": { severityNote: "step", meaning: "The last entry of every fleet list, and always present: `status` grades nothing, so the least it can do is say where grading happens — `loam validate --all` is the gate this repository has to pass and the one CI runs.", fix: "The step IS the action: run its `command`, `loam validate --all --json`." },
    "next.recover-commit": { severityNote: "step", meaning: "Always first, and never elided by the fleet form's cap: a journaled writer was killed mid-commit, so everything below this step is derived from files that may be half-written. Where the journal itself cannot be read, nothing below can be trusted until a human compares the living docs against version control.", fix: "The step IS the action: run its `command` — the interrupted command re-run, which recovers first under the lock, or `loam doctor --json` when the journal is unreadable and no loam command can repair it." },
    "next.archived": { severityNote: "step", meaning: "The whole `next[]` for an archived feature: its delta is folded into the living docs. Archiving checks documents, not code, so the step also says whether the feature was ever verified. The repository-wide `loam status` gives the same step for every archived feature whose verdict is not `verified`, so open claims do not disappear at archive.", fix: "The step IS the action: run its `command`, `loam show <FEAT-id> --json`." },
    "next.author-intent": { severityNote: "step", meaning: "The feature has no intent document — what it is for, in prose, before anything is derived from it.", fix: "The step IS the action: write the file the step names, then run its `command`, `loam validate <FEAT-id> --json`. The command never writes the artifact: loam does not author." },
    "next.touch-service": { severityNote: "step", meaning: "The feature carries no per-service delta at all, so nothing says which governed boundaries it changes.", fix: "The step IS the action: run its `command`, `loam list services --json`, then add specs/<service>/spec.md for every service the feature changes." },
    "next.author-spec": { severityNote: "step", meaning: "One service the feature touches has no requirement delta — the ADDED / MODIFIED / REMOVED requirements the feature makes to that service, each with a scenario.", fix: "The step IS the action: write the file the step names, then run its `command`, `loam delta <FEAT-id> --service <id> --json`, which projects the delta onto the living document." },
    "next.author-openapi": { severityNote: "step", meaning: "Nothing gives one of the feature's services a living openapi.yaml, so this feature is the only thing that can write down its API surface. Deliberately not phrased as the service being absent from the living docs: a service adopted without a contract is the commoner case, and that wording sent readers looking for a directory that was right there.", fix: "The step IS the action: write the file the step names, then run its `command`, `loam delta <FEAT-id> --service <id> --json`." },
    "next.author-scenarios": { severityNote: "step", meaning: "Requirements in one service's delta carry no `#### Scenario:`, so they generate no test and no verify claim — a promise that reaches neither the suite nor the done-check. One entry per service and never per requirement, because a delta with forty bare requirements would otherwise BE the payload.", fix: "The step IS the action: write a scenario under each bare requirement, then run its `command`, `loam delta <FEAT-id> --service <id> --json`." },
    "next.redraw-flows": { severityNote: "step", meaning: "Living flows of one service claim requirements the feature MODIFIES — the set `usecase.requirement-modified` names. After the archive their tags still resolve and nothing grades what they draw against the new wording, so a flow the change makes untrue would stay living and green. One entry per service, never per flow, and only for flows under the service's usecases/: a fleet flow under architecture/, or a service flow in views.likec4 or model.likec4, has no slot and is left to the warning, which says to edit it in place.", fix: "The step IS the action: read each flow against the rewritten requirement, then redraw it in `path` (features/<FEAT>/specs/<svc>/usecases/) under the living file's name — the archive replaces the living file — or put it there unchanged if it still holds, which confirms it and silences the warning. `loam delta <FEAT-id> --service <id> --json` lists them as `useCases.redraw`." },
    "next.rebase": { severityNote: "step", meaning: "The feature carries requirements or operations with no baseline pin, on any of the three axes; until they have one the merge cannot tell what it EDITS from what it merely quotes.", fix: "The step IS the action: run its `command`, `loam rebase <FEAT-id>`." },
    "next.archive-first": { severityNote: "step", meaning: "The feature builds on other features still in flight, which have to archive before it can.", fix: "The step IS the action: run its `command`, `loam dependencies <FEAT-id> --json`." },
    "next.fix-coherence": { severityNote: "step", meaning: "The feature has findings that stop it, named starting with the first. Everything EITHER gate refuses on is counted, so a warning marked as gating archive is in the tally even though `validate` grades the feature valid — which is why its exit code alone will not show you why archive refuses.", fix: "The step IS the action: run its `command`, `loam validate <FEAT-id> --json`." },
    "next.generate-tests": { severityNote: "step", meaning: "The feature's delta for a service carries scenarios no test run has answered yet. `loam gherkin` writes the .feature files whose green run is the only thing that may answer a `scenario.tested` claim, and it writes into the service's own repository — so the step names which repo to run it in when that is not this one.", fix: "The step IS the action: run its `command`, `loam gherkin <FEAT-id> --service <id>`, from that service's own checkout." },
    "next.verify": { severityNote: "step", meaning: "The done-check has not been started, or its record cannot be used. Five situations share this code because they share the work — nothing recorded, a record file that does not read as a record, a record the feature has moved out from under, a record that answers no claims at all, and a feature with nothing to derive a checklist from yet — and the step's own statement says which.", fix: "The step IS the action: run its `command`, `loam verify <FEAT-id> --json`, which derives the checklist and prints what it asks. A record file nothing can read is repaired by hand or, when it is one service's own `verification/<svc>.yaml`, deleted and recorded again by that service; the one-file `verification.yaml` may hold other services' attestations and is restored from version control, never deleted. Nothing overwrites it while it is unreadable." },
    "next.verify-unconfirmed": { severityNote: "step", meaning: "Claims on the feature are open — unconfirmed or unanswered — and this repository is not one of the services that owes an answer, so the recording form is not a step anyone can take from here.", fix: "The step IS the action: run its `command`, `loam verify <FEAT-id> --json`. The open claims are closed from each affected service's own repository." },
    "next.attest-service": { severityNote: "step", meaning: "Claims are open AND this repository is one of the services that owes an answer, so the recording form is nameable here: `--record --service` binds the answers to this repo's HEAD and refuses anywhere else.", fix: "The step IS the action: run its `command`, `loam verify <FEAT-id> --record answers.json --service <id>`, answering the claims filed under this service; the rest belong to their own repositories." },
    "next.verify-attested": { severityNote: "step", meaning: "Every claim is answered and some scenario claims are confirmed on an agent's word rather than on a test run (`verify.scenario-attested`) — complete work resting on an assertion, which is what `ready` has always meant here.", fix: "The step IS the action: run its `command`, `loam verify <FEAT-id> --results <report.json>` — a cucumber JSON report, or loam's runner-neutral `loamScenarioReport` shape for any other runner — and the record stops resting on an assertion." },
  },
};

/**
 * `loam diff` — what CHANGED between a base git ref of the docs repo and the
 * working tree, not what is WRONG with either. That is why most rows below have
 * no repair: the meanings are the `DiffCode` union's own doc comments
 * (core/diff/semantic.ts), and the two error rows are the only ones naming a
 * repair. The two `-modified` rows name work too, but not loam's: whether a
 * changed schema breaks its readers is the specialist diff's answer.
 */
const DIFF: Family = {
  scope: "loam diff --base <ref>",
  codes: {
    "diff.service-added": { severityNote: "ok", meaning: "A services/<id>/ directory exists now that did not exist at the base ref.", fix: "Nothing to fix: `loam diff` says what changed between two points of the living docs, never what is wrong with them. This is the class of the change, for a reviewer to read." },
    "diff.service-removed": { severityNote: "warn", meaning: "A service present at the base ref is gone from the working tree; the finding names the directory it occupied.", fix: "A review question rather than a defect: nothing in the working tree describes that boundary any more. `loam validate --all` is what grades the fleet that is left." },
    "diff.requirement-added": { severityNote: "ok", meaning: "A living requirement not present at base — by `Requirement-ID:` where one is authored, by heading otherwise, the same join `loam rebase` pins against.", fix: "Nothing to fix: this is the class of the change, for a reviewer to read." },
    "diff.requirement-removed": { severityNote: "warn", meaning: "A requirement present at the base ref is no longer in the living spec under the same identity.", fix: "A review question. A requirement that CHANGED identity — a new `Requirement-ID:`, a renamed heading — reads here as a removal plus an addition, which is the join being honest about what it can see rather than guessing a rename." },
    "diff.requirement-modified": { severityNote: "ok", meaning: "The same requirement identity is on both sides and its digest moved. A rebase pin never moves that digest, so this is a real edit to the requirement's text.", fix: "Nothing to fix: this is the class of the change, for a reviewer to read." },
    "diff.op-added": { severityNote: "ok", meaning: "An operationId in the living contract that was absent at the base ref; the message names its method and path.", fix: "Nothing to fix: this is the class of the change, for a reviewer to read." },
    "diff.op-removed": { severityNote: "warn", meaning: "A base operationId is gone from the living contract and no current edge of the `architecture/` project, requirement or use-case hop names it — or, in the second wording this code also carries, whether one does could NOT be fully answered, and the details name the possible consumers nobody could check: a consumer document that was not scannable, or a landscape edge into this service drawn with no `metadata { op }`.", fix: "Read which of the two sentences it is. Nobody could be checked is never nobody names it: an unreadable document carries the run to exit 1 on its own, and an edge with no op is answered by putting the operation it calls on the edge (`spine.op-link-missing` names the same edge)." },
    "diff.op-removed-consumed": { severityNote: "error", meaning: "An operation was removed since the base ref and the current fleet still names it — an edge of the `architecture/` project, another service's requirement in spec.md or arch.spec.md (not one naming its own service's operation of the same id), or a use-case hop attributed to it: the consumers the archive gate refuses on too. The details list the victims, and the finding sets `breaking`.", fix: "These joins break. Either restore the operation, or land the consumers' own deltas in the same change so nothing in the fleet is left calling something that is gone." },
    "diff.op-deprecated": { severityNote: "warn", meaning: "`deprecated: true` was introduced on an operation since the base ref. The details name the current consumers, under one of three deliberately honest phrasings: some still name it, none does, or whether any does could not be fully answered.", fix: "Deprecation is a promise to the consumers the details name, and nothing is broken yet. Read which phrasing it is before treating a silent list as an empty one." },
    "diff.op-modified": { severityNote: "warn", meaning: "The same operationId is on both sides and the operation changed: its own definition, its method or path, or anything its internal `$ref`s reach — a field renamed in a shared `components` schema counts. The details name the authored consumers, the same scan `diff.op-deprecated` runs. loam does not read what a schema says, so it never grades whether the change is breaking.", fix: "Run `oasdiff breaking` on the two states of this contract to learn whether it breaks anyone; the details are who to tell. A warning on purpose: a new optional field and a renamed required one look identical from here." },
    "diff.message-added": { severityNote: "ok", meaning: "An AsyncAPI message name absent at the base ref.", fix: "Nothing to fix: this is the class of the change, for a reviewer to read." },
    "diff.message-removed": { severityNote: "warn", meaning: "A base message is gone. The finding says which of three cases it is: another current service still sends it (an `action: send` operation — a service that only receives it is a consumer) or an `#external` element still publishes it (a `publishes` edge from it in the `architecture/` project, the outside producer `spine.message-unproduced` accepts), nothing currently consumes it, or whether anything does could not be fully answered because some consumer documents were not scannable.", fix: "Read which case it is. A name another service still sends, or an `#external` element still publishes, is not orphaned, and an unanswerable scan is not an empty one — only positive evidence vouches here." },
    "diff.message-removed-consumed": { severityNote: "error", meaning: "A message was removed since the base ref and the current fleet still consumes it — a `Consumes:` line in either spec file, a consumes edge of the `architecture/` project, or a use-case hop it backs. The details list the victims, and the finding sets `breaking`.", fix: "These joins break. Either restore the message, or land the consumers' own deltas in the same change." },
    "diff.message-modified": { severityNote: "warn", meaning: "The same AsyncAPI message name is on both sides and its declaration, or anything its internal `$ref`s reach, changed — a payload field renamed counts. The details name the authored consumers: consumes-edges, `Consumes:` lines and the use-case hops they back. Content equality only: nothing inside the payload is ever joined on, and whether the change breaks a consumer is not graded.", fix: "Run `asyncapi diff` on the two states of this contract to learn whether it breaks anyone; the details are who to tell." },
    "diff.consumer-added": { severityNote: "ok", meaning: "A cross-service join appeared since base: another service's living requirements — spec.md or arch.spec.md — now name this service's operation or message. A line naming an operation the consumer's own contract defines names its own, and is no join. Filed on the PROVIDER — the service whose surface the join lands on.", fix: "Nothing to fix, and the change class most worth reading: a new consumer is a new obligation on this service's contract, and removing that operation later is what `diff.op-removed-consumed` will be about." },
    "diff.consumer-removed": { severityNote: "ok", meaning: "A cross-service join present at the base ref is gone: a consumer's living requirements no longer name this service's operation or message.", fix: "Nothing to fix: this is the class of the change, for a reviewer to read." },
  },
};

/**
 * `loam gate` — the can-i-deploy question, a pure query over evidence other
 * commands already recorded. Nothing here re-derives a coherence plan, so every
 * repair below is somebody else's command.
 */
const GATE: Family = {
  scope: "loam gate",
  codes: {
    "gate.partners-unknown": { severityNote: "warn when the map is absent; error when it exists and cannot be used", meaning: "The partner set for the gated service could not be derived from architecture/landscape.likec4 — it is absent, or it exists and does not parse. That means nobody could look, never that nothing joins this service. Absent is a warning because a repo before its first adopt legitimately has no map yet; a broken map is an error because `loam validate --all` fails that repo for the same file, and a deploy gate passing where the fleet gate fails would be the quieter of two contradictory verdicts.", fix: "Fix the landscape and re-run. `loam validate --all` diagnoses the file itself; this check only refuses the false silence." },
    "gate.service-undocumented": { severityNote: "error", meaning: "The service being deployed sits below `documented` on the adoption ladder, so the docs cannot say what its joins even are and no recorded evidence can answer the deploy question. That includes a spec.md marked `adoption: partial` — one archived feature's slice, written into a service nobody had adopted. The details list what the next rung wants.", fix: "Author the baseline — `loam adopt --service <id>` briefs exactly what is missing — and this check passes once the required artifact set exists; for a partial adoption, write the rest of spec.md from the code and then delete its `adoption: partial` line." },
    "gate.partner-undocumented": { severityNote: "warn", meaning: "A service that joins the gated one has no services/<id>/ directory at all, or has one sitting below `documented`: its side of the join is not recorded, so the gate cannot see what that partner promises. An `#external` partner is exempt on purpose — somebody else's system is unrecorded by design.", fix: "Adopt the partner (`loam adopt --service <id>` briefs it), bind its landscape element to the right service with `metadata { service '<id>' }`, or tag it `#external` if it is not ours." },
    "gate.feature-unverified": { severityNote: "warn", meaning: "An active feature touching the gated service — or, under `--since <ref>`, one archived after that docs-repo ref (its `features/archive/` directory absent at the ref, or changed since: a feature unarchived and archived again ships again) — is not verified: no record at all, a record file that does not read as a record, a record the feature moved out from under (for an archived feature, one that no longer answered the checklist `loam archive` captured as it merged), a record answering no claims, or open claims counted in the message. A record that is merely `attested` is NOT reported under this code — it carries `verify.scenario-attested` instead, because complete work resting on an assertion is a different fact from work nobody checked. Without `--since` an archived feature is never read, so archiving one takes it out of this check.", fix: "Derive the checklist and answer every claim with evidence: `loam verify <FEAT-id> --json`. A record file nothing can read is repaired by hand or, when it is one service's own `verification/<svc>.yaml`, deleted and recorded again by that service; the one-file `verification.yaml` may hold other services' attestations and is restored from version control, never deleted. Nothing overwrites it while it is unreadable. An archived feature's record is frozen: `loam unarchive <FEAT-id>` re-opens it if its claims must be answered before the deploy." },
  },
};

/** In listing order, though every consumer sorts by code — the order is documentation, not contract. */
const FAMILIES: readonly Family[] = [DOCTOR, NEXT_STEPS, DIFF, GATE];

/** One family row, in the shape `FindingEntry` (lookup.ts) takes. */
export interface FamilyFinding extends FamilyEntry {
  readonly scope: string;
}

/**
 * The registry's answer for one subject, or null.
 *
 * Built per call over constants already in memory, never cached at module
 * level, for the reason lookup.ts's header gives: tests fork and chdir, and the
 * MCP server outlives many calls.
 */
export function familyFinding(subject: string): FamilyFinding | null {
  for (const family of FAMILIES) {
    const entry = family.codes[subject];
    if (entry !== undefined) return { scope: family.scope, ...entry };
  }
  return null;
}

/** Every code the registry answers, sorted — the same plain sort the code inventory uses. */
export function familyCodes(): string[] {
  return FAMILIES.flatMap((family) => Object.keys(family.codes)).sort();
}
