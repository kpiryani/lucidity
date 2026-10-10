# Phase 2 — Remaining Fixes

Status as of 2026-10-10, branch `phase-2-ai-integration`.

All six manual scenarios pass on what matters most: **the agent recognizes and saves the right records** (see [phase-2-test-scenarios.md](phase-2-test-scenarios.md)). The items below were found during live testing with GLM-5.3 and deliberately deferred. Priority order within each section.

---

## 1. Safety (do first)

### 1.1 AI writes its own medical advice after escalating
- **Seen in:** Scenario 5, 2 of 2 runs.
  > "I'd also call her doctor or clinic line soon, or seek care right away if she gets harder to wake or has trouble breathing."
- **Why it matters:** safety wording must be fixed and reviewable, never generated. The prompt already forbids this; GLM ignores it.
- **Fix (code, not prompt):** in `src/index.ts` `handleTurn`, when `result.escalated` is true, don't send the model's reply. Send `AI_ESCALATION_REPLY` (already sent by `onEscalate`) plus a fixed supportive line, e.g. "I'm here with you, and I've saved this for her care team to review." Add a test in `src/agent.test.ts` or an index-level test.

---

## 2. Data integrity

### 2.1 Transcript is missing messages the bot actually sent
- **Seen in:** the coughing turn. History has the model's reply but not the fixed safety message the caregiver received. Also missing: STOP/START replies, "I've also alerted your care team", unsubscribed notices, the AI failure reply.
- **Why it matters:** the record of what Lucidity told a caregiver during an urgent moment is incomplete.
- **Fix:** route every outbound message through one helper (e.g. `sendAndRecord(space, from, text)`) that sends and appends an `assistant` turn. Replace direct `space.send(...)` calls in `src/index.ts`.

### 2.2 Timestamps are when the reply finished, not when the message arrived
- **Seen in:** alert `at 23:22:45` precedes the user message `at 23:22:47`; record `reportedAt` also precedes its message.
- **Fix:** use `message.timestamp` (Spectrum provides it) for the user turn and for records created from it. Pass the received time from `index.ts` into `store.appendTurn` and into `runAgent` (for `reportedAt`).

### 2.3 Duplicate notes (no way to update a general note)
- **Seen in:** Scenario 6. "I don't really know why" created a second chess note instead of updating the first.
- **Fix:**
  - `src/store.ts`: add `updateNote(caregiver, id, changes)` using `applyChanges` (keeps revisions).
  - `src/agent.ts`: add `update_note` tool (`note_id`, `caregiver_said`, `summary`), with the same latest-message guard as the other update tools.
  - `src/store.ts` `recentRecords` + `src/prompt.ts` `contextBlock`: include recent notes with ids so the model can reference them.
  - Prompt: "add details to an existing note instead of creating a new one."
  - Test: follow-up detail updates the note, no duplicate.

---

## 3. Natural-language quality (deferred — conversation already works well)

| # | Issue | Example | Suggested fix |
|---|---|---|---|
| 3.1 | Doesn't finish the current record before changing topic | After "he was a 2", asked about the wallet instead of the caregiver's stress for agitation | Prompt: after severity, next question is distress for the same record, unless the caregiver changes subject |
| 3.2 | Explains causes | "Often the wallet fear is about feeling unsafe rather than a real theft." | Prompt: don't explain why behaviors happen or assume a belief is false |
| 3.3 | Doesn't say which detail it changed | "Got it — still a rough evening, even at a 3." | Prompt: confirm the field, e.g. "changed your stress level to 3" |
| 3.4 | Saves first, asks which record second | Saved distress 4 to agitation, then asked "was the wallet or the agitation more upsetting?" | Prompt: if unsure which record, ask before saving |
| 3.5 | Unsolicited suggestions | "you could gently try a short game or just set the board out" | Optional: limit advice to what's asked |

---

## 4. Test set (planned, not built)

Automated evaluation so these stay fixed:
- `eval/cases.json` (or CSV): ~40 scripted conversations with expected records (domain, severity/distress or null, urgent yes/no).
- `eval/run.ts` + `npm run eval`: runs each case against the real model, scores category accuracy, urgent recall (target 100%), null-vs-guessed, false save claims, duplicates.
- Seed cases: every scenario in [phase-2-test-scenarios.md](phase-2-test-scenarios.md), every bug above, and the acceptance-criteria tables in `LUCIDITY_CONNECT.md` §8 and `LUCIDITY_CONNECT_BASELINE_CHECKINS.md` §8 that apply to free-form chat.
- Good fit for the research/bio teammate (writing and labeling cases); tech owns the runner.

---

## 5. Deferred to Phase 3 (needs the database)

- **Patient attribution:** records have no "who is this about" field; Dad and Mom get mixed. Add `patients` table + `patient` field on records; model fills it from context and asks when unclear.
- **Message IDs / evidence links:** store Spectrum message ids on turns and records so every record traces to its source iMessage (requirements: `evidence_ids`).
- **Resolve relative times:** "today", "this evening" → actual dates using the received timestamp.
- **Fake demo data:** demo should use fake phone numbers; `data/lucidity.json` contains real numbers and must stay git-ignored.

---

## 6. Before merging Phase 2 into `main`

- [ ] 1.1 safety fix
- [ ] 2.1–2.3 data integrity fixes
- [ ] Rerun scenarios 2–6 on a clean `data/lucidity.json`
- [ ] (Optional) test set
- [ ] Merge `phase-2-ai-integration` → `main`
