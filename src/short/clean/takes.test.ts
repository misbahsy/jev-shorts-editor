import test from "node:test";
import assert from "node:assert/strict";
import { guardProposals, packPhrases, packTranscript, parseProposals, selectTakes } from "./takes";
import { script } from "./testutil";

// phrases: P0 "One" | P1 "first one is to ask Claude to mimic a video" | P2 redo ... separated by 0.6 s pauses
const RAW = "One ~0.6 first one is to ask Claude to mimic a video ~0.6 Simply reference a video ~0.6 Simply provide a reference video and ask Claude to mimic for your edits ~0.6 Now you definitely need Opus for this because it ~0.6 Now you definitely need Opus for it because that is the beast model";
const words = () => script(RAW);
const idx = (w: ReturnType<typeof words>, text: string, nth = 0) => w.filter(x => x.text === text)[nth].i;

test("phrases split on pauses of half a second and lines carry times and indices", () => {
  const w = words();
  const ph = packPhrases(w);
  assert.equal(ph.length, 6);
  assert.deepEqual([ph[0].from, ph[0].to], [0, 0]);
  const t = packTranscript(w, ph).split("\n");
  assert.equal(t.length, 6);
  assert.match(t[0], /^\[0\.0-0\.3\] One\{0\}$/);
  assert.match(t[1], /first\{1\} one\{2\} is\{3\}/);
  // a 0.4 s pause does not split
  assert.equal(packPhrases(script("a b ~0.4 c d")).length, 1);
});

test("parseProposals reads plain, fenced and think-prefixed JSON and rejects junk", () => {
  const body = '{"drops":[{"from":2,"to":4,"reason":"redo"}]}';
  assert.deepEqual(parseProposals(body), [{ from: 2, to: 4, reason: "redo" }]);
  assert.equal(parseProposals("```json\n" + body + "\n```").length, 1);
  assert.equal(parseProposals("<think>hmm {x}</think>\nHere: " + body).length, 1);
  assert.throws(() => parseProposals("no json here"));
  assert.throws(() => parseProposals('{"other":1}'));
});

test("a stray one-word phrase is dropped, an earlier take with a later twin is dropped", () => {
  const w = words();
  const simplyRef = idx(w, "Simply", 0);
  const r = guardProposals({
    words: w,
    alreadyRemoved: new Set(),
    proposals: [
      { from: 0, to: 0, reason: "stray word before the real sentence" },
      { from: simplyRef, to: simplyRef + 3, reason: "shorter take of the next line" },
    ],
  });
  assert.equal(r.decisions.every(d => d.accepted), true);
  assert.ok(r.drops.has(0) && r.drops.has(simplyRef + 3));
  assert.equal(r.drops.get(0), "stray word before the real sentence");
});

test("the last take of a line cannot be dropped, even if the model proposes it", () => {
  const w = words();
  const lastTake = idx(w, "Now", 1);
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from: lastTake, to: w.length - 1, reason: "bad take" }] });
  assert.equal(r.decisions[0].accepted, false);
  assert.match(r.decisions[0].rejected ?? "", /last take/);
  assert.equal(r.drops.size, 0);
});

test("two takes of one line: the model can drop the first and not both", () => {
  const w = words();
  const a = idx(w, "Now", 0);
  const b = idx(w, "Now", 1);
  const r = guardProposals({
    words: w,
    alreadyRemoved: new Set(),
    proposals: [
      { from: a, to: b - 1, reason: "abandoned" },
      { from: b, to: w.length - 1, reason: "also abandoned" },
    ],
  });
  const acc = r.decisions.filter(d => d.accepted);
  assert.equal(acc.length, 1);
  assert.equal(acc[0].from, a);
});

test("unique content, bad indices and a short drop inside a phrase are refused", () => {
  const w = words();
  const ask = idx(w, "ask", 0);
  const r = guardProposals({
    words: w,
    alreadyRemoved: new Set(),
    proposals: [
      { from: -1, to: 2, reason: "x" },
      { from: 5, to: 99999, reason: "x" },
      { from: 4, to: 2, reason: "x" },
      { from: 1.5 as number, to: 2, reason: "x" },
      { from: idx(w, "provide"), to: idx(w, "provide"), reason: "a word from the middle of a phrase, never said again later" },
      { from: idx(w, "beast"), to: idx(w, "model"), reason: "the ending is unique" },
    ],
  });
  assert.equal(r.decisions.length, 6);
  assert.ok(r.decisions.every(d => !d.accepted));
  assert.equal(r.drops.size, 0);
  assert.ok(ask > 0);
});

test("the last phrase is never dropped as a short slip", () => {
  const w = script("Real sentence here ~0.8 Thanks");
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from: 3, to: 3, reason: "stray" }] });
  assert.equal(r.decisions[0].accepted, false);
});

test("what the model adds cannot pass the cap of the speech, whatever Jev already removed", () => {
  // ten identical lines: the model proposes dropping the first nine; Jev already took two
  const lines = Array.from({ length: 10 }, () => "we cut the long boring take again").join(" ~0.6 ");
  const w = script(lines);
  const per = 7;
  const proposals = Array.from({ length: 9 }, (_, k) => ({ from: k * per, to: k * per + per - 1, reason: "earlier take" }));
  const jev = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const r = guardProposals({ words: w, alreadyRemoved: jev, proposals });
  assert.ok(r.drops.size <= Math.floor(w.length * 0.25), `model added ${r.drops.size} of ${w.length}`);
  assert.ok(r.drops.size > 0);
  assert.ok(r.decisions.some(d => /more than 25%/.test(d.rejected ?? "")));
  // Jev's own removals are not touched or counted against the model
  assert.ok([...jev].every(i => !r.drops.has(i)));
});

test("words Jev already removed are not counted twice, and are not the twin", () => {
  const w = words();
  const a = idx(w, "Now", 0);
  const b = idx(w, "Now", 1);
  // Jev already removed the later take, so the earlier one is the last take left
  const jev = new Set<number>();
  for (let i = b; i < w.length; i++) jev.add(i);
  const r = guardProposals({ words: w, alreadyRemoved: jev, proposals: [{ from: a, to: b - 1, reason: "dup" }] });
  assert.equal(r.decisions[0].accepted, false);
});

test("selectTakes passes the packed transcript to the model and returns guarded drops", async () => {
  const w = words();
  let seen = "";
  const sel = await selectTakes({
    words: w,
    alreadyRemoved: new Set(),
    call: async prompt => {
      seen = prompt;
      return '{"drops":[{"from":0,"to":0,"reason":"stray word"}]}';
    },
  });
  assert.equal(sel.mode, "llm");
  assert.match(seen, /One\{0\}/);
  assert.match(seen, /TRANSCRIPT/);
  assert.deepEqual([...sel.drops.keys()], [0]);
  assert.equal(sel.decisions[0].text, "One");
});

test("selectTakes falls back quietly when the call fails or the answer is not JSON", async () => {
  const logs: string[] = [];
  const failed = await selectTakes({ words: words(), alreadyRemoved: new Set(), call: async () => { throw new Error("HTTP 500"); }, log: m => logs.push(m) });
  assert.equal(failed.mode, "fallback");
  assert.equal(failed.drops.size, 0);
  assert.match(failed.warning ?? "", /HTTP 500/);
  assert.ok(logs.some(l => /warning/.test(l)));
  const junk = await selectTakes({ words: words(), alreadyRemoved: new Set(), call: async () => "sorry" });
  assert.equal(junk.mode, "fallback");
  const off = await selectTakes({ words: words(), alreadyRemoved: new Set(), off: true });
  assert.equal(off.mode, "off");
});
