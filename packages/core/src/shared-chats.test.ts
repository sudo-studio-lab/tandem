import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {openFsDataStore} from "./data/index.ts";
import {publishChat,sharedChats,withdrawOwnChats} from "./shared-chats.ts";
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
it("keeps project and owner snapshots separate, rejects credentials, and withdraws only one's own",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-shares-"));dirs.push(dir);const s=openFsDataStore(dir);
 const t={id:"a".repeat(64),source:"codex" as const,title:"Scope",updatedAt:new Date().toISOString(),messages:[{role:"user" as const,text:"Project notes"}]};
 await publishChat(s,"team/a","alice",t);await publishChat(s,"team/a","bob",t);await publishChat(s,"team/b","alice",t);
 expect((await sharedChats(s,"team/a")).map(c=>c.owner).sort()).toEqual(["alice","bob"]);
 await expect(publishChat(s,"team/a","alice",{...t,messages:[{role:"user",text:"ghp_"+"a".repeat(36)}]})).rejects.toThrow();
 await withdrawOwnChats(s,"team/a","alice");expect((await sharedChats(s,"team/a")).map(c=>c.owner)).toEqual(["bob"]);
 expect(await sharedChats(s,"team/b")).toHaveLength(1);
});
