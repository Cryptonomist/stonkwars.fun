/* Linking X from any page: the return path must stay on this site, and a
 * profile picture is only ever an address on X's image host, whether it comes
 * from X at sign-in or is read back out of a memo on chain. */

import { expect } from "chai";

import { AVATAR_MEMO_PREFIX, avatarMemo, cleanAvatar, readAvatarMemo, safeNext } from "../src/lib/xLink";

const X_PIC = "https://pbs.twimg.com/profile_images/1790000000000000000/AbCdEf12_normal.jpg";
const X_PIC_BIG = "https://pbs.twimg.com/profile_images/1790000000000000000/AbCdEf12_400x400.jpg";

describe("safeNext", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNext("/f/abc")).to.equal("/f/abc");
    expect(safeNext("/new?filter=247")).to.equal("/new?filter=247");
  });

  it("drops the sign-in's own query values so they cannot loop", () => {
    expect(safeNext("/leaderboard?x=sign&handle=someone&tab=7d")).to.equal("/leaderboard?tab=7d");
    expect(safeNext("/u/w?x=error&message=nope")).to.equal("/u/w");
  });

  it("refuses anything that leaves the site or goes to the API", () => {
    for (const bad of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "evil", "", null, undefined, "/api/x/start"]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).to.equal("/leaderboard");
    }
  });
});

describe("cleanAvatar", () => {
  it("takes X's picture and asks for the 400px size", () => {
    expect(cleanAvatar(X_PIC)).to.equal(X_PIC_BIG);
    expect(cleanAvatar(X_PIC_BIG)).to.equal(X_PIC_BIG);
  });

  it("refuses other hosts, paths, schemes and tricks", () => {
    for (const bad of [
      "http://pbs.twimg.com/profile_images/1/a_normal.jpg",
      "https://pbs.twimg.com.evil.example/profile_images/1/a.jpg",
      "https://evil.example/profile_images/1/a.jpg",
      "https://pbs.twimg.com/media/1/a.jpg",
      "https://pbs.twimg.com/profile_images/1/a.jpg?x=1",
      "https://user:pw@pbs.twimg.com/profile_images/1/a.jpg",
      "https://pbs.twimg.com:8443/profile_images/1/a.jpg",
      `https://pbs.twimg.com/profile_images/${"a".repeat(220)}.jpg`,
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(cleanAvatar(bad as string | null), String(bad)).to.equal(null);
    }
  });
});

describe("avatar memo", () => {
  it("round-trips a picture", () => {
    const memo = avatarMemo(X_PIC_BIG);
    expect(memo.startsWith(AVATAR_MEMO_PREFIX)).to.equal(true);
    expect(readAvatarMemo(memo)).to.equal(X_PIC_BIG);
  });

  it("ignores memos that are not ours or carry a URL X would not name", () => {
    expect(readAvatarMemo(X_PIC_BIG)).to.equal(null);
    expect(readAvatarMemo(`${AVATAR_MEMO_PREFIX}https://evil.example/a.jpg`)).to.equal(null);
    expect(readAvatarMemo("gm")).to.equal(null);
    expect(readAvatarMemo(null)).to.equal(null);
  });
});
