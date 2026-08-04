import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// tsc does not remove output for sources that were renamed or deleted. A clean
// build keeps those ghosts out of both local smoke tests and published tarballs.
await rm(join(projectRoot, "dist"), { recursive: true, force: true });
