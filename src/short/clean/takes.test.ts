import test from "node:test";
import assert from "node:assert/strict";
import { guardProposals, packPhrases, packTranscript, parseProposals, QUIET_MARK, selectTakes } from "./takes";
import { buildTakesPrompt } from "./takesPrompt";
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

// ---- alternate takes: back-to-back phrasings of one claim ----
const OPENER = "Claude just killed video editors. Claude just killed video editors with Opus 5.5. You don't need video editors. With Opus 5.5, you don't need video editors. You see this video, it's all edited by Claude.";
// 0-4 | 5-12 | 13-17 | 18-25 | 26-...

test("the opener: Jev took the first two lines, the model drops the earlier of the two that remain", () => {
  const w = script(OPENER);
  assert.equal(w[5].text, "Claude");
  assert.equal(w[12].text, "5.5.");
  assert.equal(w[18].text, "With");
  assert.equal(w[25].text, "editors.");
  const jev = new Set<number>([0, 1, 2, 3, 4, 13, 14, 15, 16, 17]);
  const r = guardProposals({ words: w, alreadyRemoved: jev, proposals: [{ from: 5, to: 12, reason: "alternate phrasing of the claim" }] });
  assert.equal(r.decisions[0].accepted, true, r.decisions[0].rejected);
  assert.deepEqual([...r.drops.keys()].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12]);
});

test("an earlier phrasing with few words in common by ratio, but most of the later sentence, goes through the alternate rule", () => {
  // the twin rule alone refuses this (5 of 11 content words said again), the alternate rule believes it
  const w = script("Claude just completely killed all video editors forever with Opus 5.5. With Opus 5.5, video editors are finished. You see this video, it is all edited by Claude and nobody touched a timeline at any point during the whole edit, which still amazes me every single time.");
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from: 0, to: 10, reason: "alternate phrasing" }] });
  assert.equal(r.decisions[0].accepted, true, r.decisions[0].rejected);
});

test("the later phrasing may go only when the earlier sentence is at least as full", () => {
  const tail = " You see this video, it is all edited by Claude and nobody touched a timeline at any point during the whole edit, which still amazes me every single time.";
  // the earlier sentence is the fuller one, so the model may drop the later phrasing (the real opener case)
  const fuller = script("Claude just completely killed all video editors forever with Opus 5.5. With Opus 5.5, video editors are finished." + tail);
  const ok = guardProposals({ words: fuller, alreadyRemoved: new Set(), proposals: [{ from: 11, to: 17, reason: "alternate phrasing" }] });
  assert.equal(ok.decisions[0].accepted, true, ok.decisions[0].rejected);
  // the earlier sentence is a stub of the later one: the finished take stays
  const stub = script("Opus 5.5, video editors. Claude just completely killed all video editors forever with Opus 5.5, so nobody needs them." + tail);
  const no = guardProposals({ words: stub, alreadyRemoved: new Set(), proposals: [{ from: 4, to: 17, reason: "alternate phrasing" }] });
  assert.equal(no.decisions[0].accepted, false);
});

test("the opener as the model proposed it: the later phrasing is dropped, the fuller earlier one stays", () => {
  const w = script(OPENER);
  const jev = new Set<number>([0, 1, 2, 3, 4, 13, 14, 15, 16, 17]);
  const r = guardProposals({ words: w, alreadyRemoved: jev, proposals: [{ from: 18, to: 25, reason: "alternate phrasing" }] });
  assert.equal(r.decisions[0].accepted, true, r.decisions[0].rejected);
  assert.ok(r.drops.has(18) && !r.drops.has(5));
});

test("the opener: with both phrasings proposed, only one is dropped", () => {
  const w = script(OPENER);
  const jev = new Set<number>([0, 1, 2, 3, 4, 13, 14, 15, 16, 17]);
  const r = guardProposals({
    words: w,
    alreadyRemoved: jev,
    proposals: [
      { from: 5, to: 12, reason: "alternate phrasing" },
      { from: 18, to: 25, reason: "alternate phrasing" },
    ],
  });
  assert.equal(r.decisions.filter(d => d.accepted).length, 1);
  assert.ok(r.drops.has(18) && !r.drops.has(5), "later drops are judged first, so the later phrasing goes and the earlier one stays");
});

test("a claim followed by its consequence is not an alternate take", () => {
  const w = script("Claude just killed video editors. You don't need video editors anymore. You see this video, it's all edited by Claude.");
  // 0-4 headline, 5-9 consequence: they share 'video editors' only
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from: 0, to: 4, reason: "same claim" }] });
  assert.equal(r.decisions[0].accepted, false);
  assert.equal(r.drops.size, 0);
});

test("a sequential list is not an alternate take", () => {
  const w = script("Pick the angle for every clip. Pick the music for every clip. Export it.");
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from: 0, to: 5, reason: "same line" }, { from: 6, to: 11, reason: "same line" }] });
  // the first has no repeated content beyond 'pick' and 'clip'; the last-take rule keeps the final line
  assert.equal(r.decisions.filter(d => d.accepted && d.from === 6).length, 0);
});

test("two similar sentences far apart, or with a long passage between, are left alone", () => {
  const farApart = script("Claude just killed video editors with Opus 5.5. ~16 With Opus 5.5, you don't need video editors. Bye now.");
  const a = guardProposals({ words: farApart, alreadyRemoved: new Set(), proposals: [{ from: 8, to: 14, reason: "alt" }] });
  assert.equal(a.decisions[0].accepted, false);
  const between = script("Claude just killed video editors with Opus 5.5. First we plan every scene carefully together before any recording starts today. With Opus 5.5, you don't need video editors. Bye now.");
  const b = guardProposals({ words: between, alreadyRemoved: new Set(), proposals: [{ from: 18, to: 24, reason: "alt" }] });
  assert.equal(b.decisions[0].accepted, false);
});

test("the cap still limits alternate takes", () => {
  const lines = Array.from({ length: 6 }, (_, k) => `Number ${k} shows that Claude edits video editors with Opus 5.5.`).join(" ");
  const w = script(lines);
  const per = 11;
  const proposals = Array.from({ length: 5 }, (_, k) => ({ from: k * per, to: k * per + per - 1, reason: "alt" }));
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), proposals });
  assert.ok(r.drops.size <= Math.floor(w.length * 0.25), `${r.drops.size} of ${w.length}`);
});

test("the prompt tells the model about alternate takes and quiet pickups", () => {
  const p = buildTakesPrompt("[0.0-1.0] a{0}");
  assert.match(p, /SAME claim in different words/);
  assert.match(p, /\(quiet pickup\)/);
  assert.ok(QUIET_MARK.includes("quiet pickup"));
});

// ---- recovered speech ----
// "... use a skill like video use." then a recovered dangling scrap, then "Second is to use a prompt."
const RECOVER = "Or use a skill like video use. ~10 and then apply to your video. ~10 Second is to use a prompt that worked for others, and honestly it has saved me hours of tedious manual cutting across every single project this month.";
const rw = () => script(RECOVER);

test("a recovered scrap is dropped as one range even with no twin", () => {
  const w = rw();
  const from = w.findIndex(x => x.text === "and");
  const to = from + 5;
  assert.equal(w[to].text, "video.");
  const rec = new Set<number>(Array.from({ length: 6 }, (_, k) => from + k));
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), recovered: rec, proposals: [{ from, to, reason: "dangling fragment" }] });
  assert.equal(r.decisions[0].accepted, true, r.decisions[0].rejected);
  assert.equal(r.drops.size, 6);
  // the same range without the recovered flag is a unique, last-take-of-its-line drop: refused
  const plain = guardProposals({ words: w, alreadyRemoved: new Set(), proposals: [{ from, to, reason: "dangling fragment" }] });
  assert.equal(plain.decisions[0].accepted, false);
  // and so is a range that only partly overlaps the recovered words
  const partial = guardProposals({ words: w, alreadyRemoved: new Set(), recovered: new Set([from]), proposals: [{ from, to, reason: "x" }] });
  assert.equal(partial.decisions[0].accepted, false);
});

test("a recovered drop longer than the scrap limit still needs a twin", () => {
  const w = script(Array.from({ length: 14 }, (_, k) => `w${k}`).join(" ") + " ~1 end here");
  const rec = new Set<number>(Array.from({ length: 14 }, (_, k) => k));
  const r = guardProposals({ words: w, alreadyRemoved: new Set(), recovered: rec, proposals: [{ from: 0, to: 13, reason: "x" }] });
  assert.equal(r.decisions[0].accepted, false);
});

test("selectTakes marks quiet-pickup phrases for the model and lets it drop them", async () => {
  const w = rw();
  const from = w.findIndex(x => x.text === "and");
  const rec = new Set<number>(Array.from({ length: 6 }, (_, k) => from + k));
  let seen = "";
  const sel = await selectTakes({
    words: w,
    alreadyRemoved: new Set(),
    recovered: rec,
    call: async prompt => { seen = prompt; return `{"drops":[{"from":${from},"to":${from + 5},"reason":"dangling fragment"}]}`; },
  });
  assert.match(seen, new RegExp("\\(quiet pickup\\) and\\{" + from + "\\}"));
  assert.doesNotMatch(seen, /\(quiet pickup\) Or/);
  assert.equal(sel.drops.size, 6);
});
