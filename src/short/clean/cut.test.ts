import test from "node:test";
import assert from "node:assert/strict";
import { buildCutFilter } from "./cut";

test("the cut graph trims video and audio per keep range, fades every join, and concats", () => {
  const g = buildCutFilter([{ start: 1, end: 3 }, { start: 5, end: 6 }], 30, 48000);
  assert.match(g, /trim=start_frame=30:end_frame=90/);
  assert.match(g, /atrim=start_sample=48000:end_sample=144000/);
  assert.match(g, /trim=start_frame=150:end_frame=180/);
  assert.equal((g.match(/afade=t=in/g) ?? []).length, 2);
  assert.equal((g.match(/afade=t=out/g) ?? []).length, 2);
  assert.match(g, /concat=n=2:v=1:a=1\[v\]\[a\]/);
});

test("a very short keep gets a fade no longer than half of it", () => {
  const g = buildCutFilter([{ start: 0, end: 1 / 30 }], 30, 48000, 0.03);
  const m = /afade=t=in:st=0:d=([0-9.]+)/.exec(g);
  assert.ok(m && Number(m[1]) <= 1 / 30 / 2 + 1e-4);
});
