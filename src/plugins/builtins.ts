import type { BuiltinPlugin } from "./api";
import { copilot } from "./copilot";
import { goodVibes } from "./goodVibes";
import { commandsPlugin } from "./commands";

// Only explicitly imported, reviewed application modules belong in this catalog.
// Files from the project directory are never discovered or executed here.
export const builtinPlugins: readonly BuiltinPlugin[] = [copilot, goodVibes, commandsPlugin];
