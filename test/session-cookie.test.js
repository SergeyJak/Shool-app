const {test}=require("node:test");
const assert=require("node:assert/strict");
const {sessionCookie,createSessionToken,parseSessionToken,parseCookies,SESSION_TTL_SECONDS}=require("../lib/auth");
test("account session persists across external navigation and browser restarts",()=>{
 const token=createSessionToken({_id:"student",username:"student",role:"student"},"test-secret");
 const header=sessionCookie(token,{secure:true});
 assert.match(header,/SameSite=Lax/);
 assert.match(header,/Max-Age=2592000/);
 assert.match(header,/HttpOnly/);
 assert.match(header,/Secure/);
 assert.equal(parseSessionToken(parseCookies(header).school_session,"test-secret").uid,"student");
 assert.equal(SESSION_TTL_SECONDS,30*24*60*60);
});
