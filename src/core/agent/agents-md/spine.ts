/**
 * Which element in the C4 model IS which service — the binding rule, and the
 * two-way completeness check `loam validate --all` runs over `services/`.
 *
 * This module used to carry the whole ID spine: every join between the
 * artifacts, the `Based-On:` baseline pins, how to draw a shared broker, and
 * how to declare a message produced outside the fleet. Those are now the
 * `loam-spine` reference page (../workflows/reference/spine.ts), printed by
 * `loam instructions loam-spine` — grammars a reader consults while writing one
 * document, in a file that was being truncated by two hosts before it reached
 * them (./command-map.ts's header has the measurement).
 *
 * THIS section stayed, and the line between it and the page it lost is worth
 * saying: an agent cannot read the landscape at all without knowing that a box's
 * title is its service id unless `metadata { service }` says otherwise. It is
 * orientation, not reference — it is needed to form the question, not to answer
 * it.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const SPINE = `## Which element IS which service

An element says which service it is with \`metadata { service 'payment-service' }\`.
Without one, its **title** is used instead — which is what most of this repo relies
on, and also the trap: rename a box in a diagram and every check joining it to
\`services/<svc>/\` silently stops matching. Bind an element whenever its title is
not exactly the directory name, and prefer binding over renaming a directory.

\`services/\` is the list of services — there is no manifest, and none should be
added. \`loam validate --all\` compares that list to the landscape both ways: a
directory nothing draws is an error, and an element with no directory is a warning.
Systems that are not ours — kafka, a payment gateway — carry \`#external\`, which
says so once and stops the warning for good.

`;
