/* The suite runs against whatever `target/deploy/duel.so` was built last, and
 * LiteSVM loads it at the address in the IDL. If the two disagree (the program
 * id was changed and only one side rebuilt) every instruction fails with
 * DeclaredProgramIdMismatch under a screenful of logs. Say so in one line. */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SO = path.resolve(ROOT, "target/deploy/duel.so");
const IDL = path.resolve(ROOT, "target/idl/duel.json");
const LIB = path.resolve(ROOT, "programs/duel/src/lib.rs");

before(function () {
  for (const file of [SO, IDL]) {
    if (!fs.existsSync(file)) {
      throw new Error(`No ${path.basename(file)}. The suite runs against a built binary. Run:  anchor build`);
    }
  }
  const idlAddress = JSON.parse(fs.readFileSync(IDL, "utf8")).address as string;
  const declared = /declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/.exec(fs.readFileSync(LIB, "utf8"))?.[1];
  if (declared && declared !== idlAddress) {
    throw new Error(
      `lib.rs declares ${declared} but the IDL says ${idlAddress}. Rebuild:  anchor build`,
    );
  }
});
