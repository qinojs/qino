// cms.versions public API — import from here, not from lib/ internals.

export { versedTables, versTable, getVers, setVers, view } from "./lib/Vers.ts";
export { tableEntriesCopyTo } from "./lib/Spaces.ts";
export { getCmsVers } from "./lib/CmsVers.ts";
export { thinHistory } from "./maintenance.ts";
export { getForNode, logDetails } from "./serverInterface.ts";
