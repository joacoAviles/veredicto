// El mapa del código (MAPA-CODIGO.md) debe estar al día y cada función de primer nivel con su comentario.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("MAPA-CODIGO.md al día y sin funciones sin comentario", () => {
  try {
    execFileSync(process.execPath, ["scripts/mapa-codigo.mjs", "--check"], { stdio: "pipe" });
  } catch (e) {
    assert.fail(String(e.stderr || e.message));
  }
});
