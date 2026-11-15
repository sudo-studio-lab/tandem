export type { DataStore, FileChange, WriteResult, GitDataStoreOptions } from "./types.ts";
export { openGitDataStore } from "./git-store.ts";
export { openFsDataStore } from "./fs-store.ts";
export { withFileLock } from "./lock.ts";
export { NETWORK_RE, isNetworkError } from "./net.ts";
