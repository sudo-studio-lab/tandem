import {expect,it} from "vitest";
import {parseJoinLink,parseJoinSecret} from "./deeplink.ts";
it("keeps a valid share secret in the fragment and ignores unrelated URLs",()=>{
 const link=`tandem://join?repo=team%2Fcode#share=${"a".repeat(43)}`;
 expect(parseJoinLink(link)).toBe("team/code");expect(parseJoinSecret(link)).toBe("a".repeat(43));
 expect(parseJoinSecret(`https://example.com/#share=${"a".repeat(43)}`)).toBeNull();
 expect(parseJoinSecret("tandem://join?repo=team/code&share=query-secret")).toBeNull();
});
