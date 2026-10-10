/**
 * The revival findings: a feature delta spelling something the living contract
 * no longer has, which an ARCHIVED feature retired.
 *
 * `openapi.op-revived` and `asyncapi.slot-revived` — one code per axis, because
 * a caller acts the same way whichever slot section came back. Both are a
 * warning that GATES archive, `openapi.baseline-missing`'s doctrine: the
 * document is legal, and re-adding a retired operation can be exactly what a
 * feature means (a rollback of a retirement, a deprecation reversed), so
 * `--approve` carries the call. What it must never be again is SILENT — the
 * merge cannot tell a quote of a dead operation from an addition, and treated
 * every one as an addition.
 *
 * The candidates are computed where both documents are already in hand — the
 * feature gate's two walks (../declared.ts, ../events/declared.ts) — and only
 * graded here, so the archive walk (./archived.ts) is paid for only when some
 * entry is absent from the living contract at all. `serviceRevivals` is the
 * same question asked standalone, for `loam rebase`, which reads no gate — on
 * the event axis through the gate's own reading of the pair
 * (./event-pair.ts), so the two cannot grade one tree two ways.
 */
import { existsSync } from "node:fs";
import type { Issue } from "../../vocabulary/issue.js";
import type { PathableService } from "../../kernel/ids/service.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featureSpecPaths } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "../../openapi/doc.js";
import { slotKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { EventMessage } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import { retiredKey, type ArchivedBy, type RetiredIndex, type RetiredLookup } from "./archived.js";
import { readEventPair, type EventPairRead } from "./event-pair.js";

/** The two remedies, spelled once: which one applies is the human's call, never loam's. */
const REMEDY =
  "Delete the quote if you only restated it; archive with --approve if the feature brings it back on purpose.";

/**
 * The feature operations the living contract does not have, by operationId —
 * the only ones a revival can be. By id rather than slot: a retired operation
 * quoted at a new path is the same operation coming back. An unreadable side
 * proves nothing (`openapi.invalid` owns it), so it yields no candidate.
 */
export function absentOperations(featDoc: OpenapiDoc, livingDoc: OpenapiDoc): Operation[] {
  if (featDoc.unreadable || livingDoc.unreadable) return [];
  const living = new Set(livingDoc.ops.filter((op) => !op.remove).map((op) => op.id));
  return featDoc.ops.filter((op) => !op.remove && !living.has(op.id));
}

/**
 * `absentOperations` that an archived feature retired. Any archived feature —
 * the one asking is never among them: coherence grades only features in flight
 * (status/feature/feature.ts), so a retirer bearing the asking feature's id is
 * another directory carrying the same id, and its retirement is as real as
 * anyone's. Excluding it by id, as this once did, could only hide a revival.
 */
export function revivedOperations(service: string, absent: readonly Operation[], index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  for (const op of absent) {
    const by = index.operations.get(retiredKey(service, op.id));
    if (by === undefined) continue;
    issues.push({
      severity: "warn",
      gates: true,
      code: "openapi.op-revived",
      subject: service,
      message: `${service}: this feature's openapi.yaml spells '${op.id}' (${op.method.toUpperCase()} ${op.path}), which the living contract no longer has — ${retirers(by)} retired it, and archiving this delta would put it back. ${REMEDY}`,
    });
  }
  return issues;
}

/** What an event delta declares that the living contract does not have. */
export interface AbsentEvents {
  /** `channels` and `operations` slots whose key the living contract lacks — their identity IS the key. */
  slots: AsyncapiSlot[];
  /** Message declarations whose NAME the living contract lacks — the join token, wherever it is declared. */
  messages: EventMessage[];
}

/**
 * The event axis's candidates. A `components.messages` slot is graded by the
 * message NAME it declares, not by its key: the name is what every join reads,
 * so a retired message redeclared under a new key is the same message back,
 * and a new message reusing a dead key is not. Absent from living is a
 * candidate; a living side that does not answer (./event-pair.ts) proves
 * nothing, so it yields none.
 */
export function absentEvents(read: EventPairRead): AbsentEvents {
  const { featDoc, featSlots, livingDoc, livingSlots } = read;
  if (!read.livingAnswers || featDoc.unreadable || livingDoc.unreadable) return { slots: [], messages: [] };
  const livingNames = new Set(livingDoc.messages.filter((m) => m.remove !== true).map((m) => m.name));
  return {
    slots: featSlots.filter((s) => !s.remove && s.section !== "components.messages" && !livingSlots.has(slotKey(s))),
    messages: featDoc.messages.filter((m) => m.remove !== true && !livingNames.has(m.name)),
  };
}

/** `absentEvents` that an archived feature retired — any archived feature, `revivedOperations`' reason. */
export function revivedEvents(service: string, absent: AbsentEvents, index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  const revive = (what: string, by: ArchivedBy): void => {
    issues.push({
      severity: "warn",
      gates: true,
      code: "asyncapi.slot-revived",
      subject: service,
      message: `${service}: this feature's asyncapi.yaml declares ${what}, which the living contract no longer has — ${retirers(by)} retired it, and archiving this delta would put it back. ${REMEDY}`,
    });
  };
  const revivedChannels = new Set<string>();
  for (const slot of absent.slots) {
    const by = index.slots.get(retiredKey(service, slot.section, slot.key));
    if (by === undefined) continue;
    if (slot.section === "channels") revivedChannels.add(slot.key);
    revive(`${slot.section}.${slot.key}`, by);
  }
  for (const message of absent.messages) {
    // A message declared inline under a channel that is itself coming back is
    // that channel's interior, and the channel's finding already names the
    // revival — one act, one finding.
    if ([...revivedChannels].some((ck) => message.slot.startsWith(`channels.${ck}.messages.`))) continue;
    const by = index.messages.get(retiredKey(service, message.name));
    if (by === undefined) continue;
    revive(`message '${message.name}' (${message.slot})`, by);
  }
  return issues;
}

/** What `serviceRevivals` needs: the feature, the service, and the run's reads. */
export interface ServiceRevivalRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  service: PathableService;
  retired: RetiredLookup;
  context?: FleetContext;
}

/**
 * Both axes' revival findings for one service, read standalone — the gate's
 * two walks compute the same candidates from the documents they already hold;
 * `loam rebase` holds none, and must not pin a revived operation as if this
 * feature were adding it. One reading of each document, the gate's: by id on
 * the contract axis through `absentOperations`, and on the event axis through
 * `readEventPair` and `absentEvents`, the walk's own reader and candidates.
 */
export async function serviceRevivals(request: ServiceRevivalRequest): Promise<Issue[]> {
  const { docsDir, featureDir, service, retired, context } = request;
  const feature = featureSpecPaths(featureDir, service);
  const living = await locateServicePaths(docsDir, service, context);
  const issues: Issue[] = [];

  const ops = existsSync(feature.openapi)
    ? absentOperations(await readOpenapi(feature.openapi, context), await readOpenapi(living.openapi, context))
    : [];
  if (ops.length > 0) issues.push(...revivedOperations(service, ops, await retired()));

  if (!existsSync(feature.asyncapi)) return issues;
  const featDoc = await readAsyncapi(feature.asyncapi, context);
  // An unreadable delta is `asyncapi.invalid` in the gate, which grades
  // nothing else against it; the guards on the living side are the pair's.
  if (featDoc.unreadable) return issues;
  const sides = { featPath: feature.asyncapi, featDoc, livingPath: living.asyncapi, livingDoc: await readAsyncapi(living.asyncapi, context) };
  const events = absentEvents(await readEventPair(sides, context));
  if (events.slots.length > 0 || events.messages.length > 0) issues.push(...revivedEvents(service, events, await retired()));
  return issues;
}

/** "archived FEAT-112", "archived FEAT-112 and FEAT-140", "archived FEAT-1, FEAT-2 and FEAT-3". */
function retirers(by: ArchivedBy): string {
  const [first, ...rest] = by;
  const list = rest.reduce((said, id, i) => `${said}${i === rest.length - 1 ? " and" : ","} ${id}`, first);
  return `archived ${list}`;
}
