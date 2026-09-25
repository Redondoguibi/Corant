import type { BuiltinPlugin } from "./api";

// Only explicitly imported, reviewed application modules belong in this catalog.
// Files from the project directory are never discovered or executed here.
export const builtinPlugins: readonly BuiltinPlugin[] = [];
