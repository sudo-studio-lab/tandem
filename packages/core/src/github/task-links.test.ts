import { expect, it } from "vitest";
import { closingIssueNumbers } from "./task-links.ts";
it("links closing keywords and keeps cross-repository references and code examples out",()=>{
  expect(closingIssueNumbers("Closes #12\nFixes team/code#13\nResolved https://github.com/team/code/issues/14\ncloses other/code#15\nfixes https://github.com/elsewhere/code/issues/16\n`closes #17`\n```md\ncloses #18\n```\nDiscloses #19\nCloses #12","team/code")).toEqual([12,13,14]);
});
