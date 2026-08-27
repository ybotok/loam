/**
 * The one question loam asks a person, and the only thing that may answer it.
 *
 * Its own package for the reason `../vet/verify.ts` is: `vouch.ts` is the flag
 * boundary and is at its line limit, and this is a distinct phase of the run —
 * everything before it decides whether asking is even legal, everything after
 * it writes. A single-file package is the shape that seam has here.
 */
import { createInterface } from "node:readline/promises";
import type { SamplePlan } from "../sample/plan.js";
import { promptClaim } from "../sample/print.js";

/** What the confirmation needs in order to state the claim it is asking about. */
export interface VouchPrompt {
  service: string;
  vouchedBy: string;
  docsDir: string;
  /**
   * The service's directory, repo-relative — `services/<subsystem>/…/<id>`, or
   * `services/<id>` unfiled. Passed in rather than joined here: the question
   * names the documents a person is about to put their name to, and naming a
   * directory that does not exist would ask them to vouch for something they
   * cannot open.
   */
  servicePath: string;
  /** Present under `--sample <n>`: the question then names the sections, not the document. */
  sample?: SamplePlan;
}

/**
 * Ask, on a terminal, and answer only on an explicit yes.
 *
 * The question states what is about to be claimed rather than asking for
 * assent to a verb: "vouch?" invites a reflex, and the whole value of this
 * command is that the reflex is the thing being interrupted. Default is no —
 * a bare Enter, a closed stdin and a Ctrl-C all mean the same thing, because
 * the only answer that may stamp a document is one somebody typed.
 *
 * A sampled run asks a NARROWER question, in the sample's own terms: the k
 * sections just listed, what the stamp will say about the rest, and what
 * `loam validate` will report until somebody reads the whole document. Asking
 * "have you read the code?" of a person who was handed four headings would
 * collect assent to a claim nobody made — and the assent is the entire
 * artifact this command produces.
 */
export async function confirmVouch(prompt: VouchPrompt): Promise<boolean> {
  const { service, vouchedBy, docsDir, servicePath, sample } = prompt;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `\nVouching for '${service}' records that YOU read the code and say ` +
        `${docsDir}/${servicePath}/ describes it.\n` +
        `It will be stamped \`status: verified\`, \`vouched_by: ${vouchedBy}\`.\n` +
        "loam has not checked this and cannot: every other check it runs is internal " +
        "consistency, which well-written prose satisfies on its own.\n" +
        (sample === undefined ? "" : `${promptClaim(sample, service)}\n`),
    );
    const answer = await rl.question(
      sample === undefined
        ? "Have you read the code? [y/N] "
        : "Have you read the sampled sections and the code? [y/N] ",
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
