export type { DataStore, FileChange, WriteResult, GitDataStoreOptions, TreeEntry, PathChange } from "./types.ts";
export { gitBlobSha, changeBytes } from "./blob.ts";
export { openGitDataStore } from "./git-store.ts";
export { openFsDataStore } from "./fs-store.ts";
export { withFileLock } from "./lock.ts";
export { NETWORK_RE, isNetworkError } from "./net.ts";
export {
  dataRepoDir,
  ensureDataRepo,
  githubHttpsUrl,
  readTandemConfig,
  resolveDataLocation,
  writeTandemConfig,
} from "./data-repo.ts";
export type { DataLocation, DataRepoOptions, RepoRef } from "./data-repo.ts";
export { copyTeamData } from "./move.ts";
export type { CopyPlan, CopyResult } from "./move.ts";
