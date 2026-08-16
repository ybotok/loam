import { type ErrorCode } from "../../../core/envelope/json.js";

/**
 * The one refusal shape both verbs raise, in a module of its own.
 *
 * It cannot live beside the commander wiring that catches it: every phase of a
 * migration throws it, and a phase that imported the wiring to reach it would
 * put the command's registration on the evaluation path of the modules being
 * registered. So the error is the package's lowest leaf, and the wiring — which
 * maps it onto an exit code in `reportCommandError` — sits above everything.
 */
export class OpenSpecCommandError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "OpenSpecCommandError";
  }
}
