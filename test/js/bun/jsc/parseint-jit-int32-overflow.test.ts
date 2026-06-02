import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// parseInt results at or above 2^31 must stay exact after the call site
// tiers up to the DFG/FTL.
//
// Regression test for a miscompile in official Linux release builds: the
// DFG's parseIntResult() (oven-sh/WebKit Source/JavaScriptCore/dfg/
// DFGOperations.cpp) did `static_cast<int>(input)` on out-of-range doubles
// — undefined behavior — and the LLVM 22 LTO backend folded the int32
// overflow guard into a bare integrality test. parseInt("80000000", 16)
// then returned -2147483648 once the function got hot, and stayed wrong
// for the life of the process. Lower tiers were unaffected, so the flip
// only appeared after JIT warmup.
//
// Only LTO release builds can exhibit the fold (debug/asan builds pass by
// construction); CI's release lanes exercise it. See oven-sh/WebKit#245.
test("parseInt keeps values >= 2^31 exact after JIT warmup", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function hex(s) { return parseInt(s, 16); }
      function dec(s) { return parseInt(s); }
      for (let i = 0; i < 200_000; i++) {
        let v = hex("80000000");
        if (v !== 2147483648) throw new Error(\`iter \${i}: parseInt("80000000", 16) === \${v}\`);
        v = hex("ffffffff");
        if (v !== 4294967295) throw new Error(\`iter \${i}: parseInt("ffffffff", 16) === \${v}\`);
        v = hex("-80000001");
        if (v !== -2147483649) throw new Error(\`iter \${i}: parseInt("-80000001", 16) === \${v}\`);
        v = dec("2147483648");
        if (v !== 2147483648) throw new Error(\`iter \${i}: parseInt("2147483648") === \${v}\`);
      }
      console.log("ok");
      `,
    ],
    env: { ...bunEnv, BUN_JSC_jitPolicyScale: "0.001" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
