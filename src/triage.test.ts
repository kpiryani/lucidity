import { test } from "node:test";
import assert from "node:assert/strict";
import { triage, triageReply, type TriageCategory } from "./triage.ts";

const cases: [string, "emergency" | "urgent" | null, TriageCategory?][] = [
  // Emergency
  ["Mom's face is drooping and her speech is slurred", "emergency", "stroke"],
  ["Dad can't move his arm since lunch", "emergency", "stroke"],
  ["He's not breathing right, I think he's choking", "emergency", "breathing"],
  ["She won't wake up", "emergency", "unresponsive"],
  ["He collapsed in the kitchen", "emergency", "unresponsive"],
  ["Dad says he has chest pain", "emergency", "chest_pain"],
  ["She had a seizure a few minutes ago", "emergency", "seizure"],
  ["He fell and hit his head on the table", "emergency", "serious_fall"],
  ["Mom fell and I can't get her up", "emergency", "serious_fall"],
  ["I can't find Dad, he wandered off", "emergency", "missing"],
  ["Grandpa has been missing since noon", "emergency", "missing"],
  ["She threatened to hurt me", "emergency", "harm"],
  ["He grabbed a knife and was waving it", "emergency", "harm"],
  ["He keeps saying he wants to die", "emergency", "harm"],
  ["I think she took too many pills", "emergency", "overdose"],
  ["She’s unresponsive", "emergency", "unresponsive"], // curly apostrophe

  // Urgent
  ["Dad fell in the bathroom this morning but seems ok", "urgent", "fall"],
  ["She's suddenly very confused today, didn't know where she was", "urgent", "sudden_confusion"],
  ["He hasn't been eating for two days", "urgent", "not_eating_drinking"],
  ["Mom has a fever of 101", "urgent", "fever"],
  ["Honestly I can't do this anymore", "urgent", "caregiver_crisis"],

  // Routine observations — no triage
  ["Dad was up pacing all night again", null],
  ["She fell asleep during dinner", null],
  ["He was missing his late wife today and cried a bit", null],
  ["He used a knife to cut his own steak, which was nice to see", null],
  ["Mom recognized me today and we talked about her childhood for 10 minutes!", null],
  ["He got irritable when the TV was too loud", null],
];

for (const [text, level, category] of cases) {
  test(`${level ?? "none"}: ${text}`, () => {
    const result = triage(text);
    if (level === null) {
      assert.equal(result, null, `unexpected match: ${JSON.stringify(result?.matches)}`);
      return;
    }
    assert.ok(result, "expected a triage match");
    assert.equal(result.level, level);
    if (category) assert.ok(result.matches.some((m) => m.category === category), JSON.stringify(result.matches));
  });
}

test("emergency reply tells the caregiver to call 911", () => {
  const result = triage("He collapsed")!;
  assert.match(triageReply(result), /call 911/i);
});

test("missing-person reply gives specific instructions", () => {
  const result = triage("I can't find Mom anywhere")!;
  assert.match(triageReply(result), /person with dementia is missing/);
});
