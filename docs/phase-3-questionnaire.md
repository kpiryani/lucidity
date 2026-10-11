# Phase 3 — Questionnaire Handoff (NPI-Q + ZBI)

Branch `phase-3-questionnaire`. Lucidity now has two modes:

- **AI conversation** (Phase 2): free-form texting, saves observations, notices cues.
- **Questionnaire mode** (new): the NPI-Q or ZBI (items 1–12) asked **word for word**, one prompt at a time, answers stored with the exact text shown, **scored by code**. Then control returns to the AI.

Like a website chatbot handing you to a specialist: the AI offers, the caregiver says YES, the questionnaire takes over, then hands back.

```
caregiver ─▶ safety rules (always first) ─▶ check-in in progress? ─yes─▶ questionnaire mode (code)
                                              │ no
                                              ▼
                                         AI conversation ──offer──▶ YES ──▶ questionnaire mode
```

## Setup

The questionnaire wording is copyrighted and this repo is public, so it is **not committed**. It lives in git-ignored files:

```
data/instruments/npiq.local.json
data/instruments/zbi.local.json
```

Blank templates showing the format are in [instruments/](instruments/) (`npiq.example.json`, `zbi.example.json`). Copy them to the paths above and fill in the wording from the licensed PDFs in `data/alzheimers_test_pdfs/` (also git-ignored). At startup the bot logs `Check-ins enabled: NPI-Q, ZBI.` (or which are missing).

Wording notes: question text is verbatim from the PDFs except: NPI-Q "Circle" → "Answer" in the instructions and a PDF text-extraction typo "Doeshe/she" → "Does he/she"; ZBI "Please circle the response" → "Please choose the response". ZBI item 6 keeps the PDF's wording ("affects our relationships").

### ZBI (items 1–12) — important label

This is **items 1–12 of the 22-item Zarit Burden Interview**, not the validated ZBI-12 short form (a different selection of items). So it is labeled "ZBI (items 1–12)", the raw total is **0–48**, and **no burden categories** are shown (the PDF's cutoffs are for the 22-item total). It's about the **caregiver** ("your relative" = the patient), one prompt per item, 0 Never – 4 Nearly always.

## How it works

**Offering (AI side)**
- Code detects cues and tells the AI "CUE MET — offer it now":
  - **NPI-Q:** 2+ different symptom domains recorded in the past 7 days (`cueMet`).
  - **ZBI:** the caregiver described their own stress (a `caregiver_wellbeing` note) or rated distress 4+ in the past 7 days (`stressCueMet`). ZBI takes priority if both cues are met.
- The AI may also offer on its own: the NPI-Q for an ongoing behavior pattern, the ZBI when the caregiver says they're exhausted or overwhelmed (in testing it offered the ZBI on the first "I'm so exhausted" message).
- The AI calls `offer_questionnaire` and writes a short invitation ending "Reply YES or NO." If it writes the invitation but forgets the tool, code records the offer anyway.
- Not offered if: a check-in is in progress or paused; the same questionnaire was completed recently (**NPI-Q 28 days**, it covers the past month; **ZBI 14 days**); it was declined in the last **7 days**; or any check-in was already offered today.

**Questionnaire mode (code side)**
- Intro names who it's about ("the patient" = Dad) and says: **Reply SKIP to skip, PAUSE to pause, RESUME to continue.**
- NPI-Q, for each of 12 domains: YES/NO → if YES, severity (1–3) → distress (0–5), using the PDF's scale wording.
- ZBI, for each of 12 items: one answer 0–4 ("never", "sometimes", "pretty often" → 3, "every single day" → 4 also work).
- Answers: clear replies are parsed by rules ("yeah", "nope", "2"). Unclear replies go to the AI interpreter, which either maps them ("the wallet thing yeah" → Yes, confirmed back as "Got it: Yes.") or writes one short clarification, after which code **re-sends the exact question**. Two unclear replies → marked unknown, move on.
- "idk" / "not sure" → **unknown, never No**. SKIP → skipped.
- An emergency message mid-check-in gets the safety reply and **pauses** the check-in. STOP also pauses it.
- Check-in replies are handled immediately (no 10-second burst wait).

**Finishing**
- Scores by code. NPI-Q: total severity (0–36) and total distress (0–60), separately. ZBI: total 0–48, no categories; results add the Alzheimer's Association 24/7 Helpline (1-800-272-3900) as a support resource. **If any answer is unknown or skipped, the status is `incomplete` and no totals are calculated** (no fabricated scores).
- Results consent is asked once and covers both questionnaires.
- First time only: "Would you like to see your results, now and after future check-ins?" — the answer is remembered.
- A marker is added to chat history so the AI knows the check-in happened; the AI only sees scores if the caregiver consented.

## Stored data (`data/lucidity.json` → `assessments`)

Each check-in: instrument, version, `administrationMode: imessage_verbatim`, recall period, respondent, patient label, status (`in_progress` / `paused` / `completed` / `incomplete`), timestamps, and per response: `itemId`, `part` (presence/severity/distress), **the exact `questionText` shown**, the caregiver's `rawReply`, `value`, `status` (valid / unknown / skipped / not_asked), and `interpretedBy` (rule / llm / system). Scores include `scoringVersion`, per-domain results, and `missingItemIds`.

## Files

| File | What |
|---|---|
| `src/instruments/npiq.ts` | NPI-Q item IDs/domains, wording loader, scoring (no copyrighted text) |
| `src/instruments/zbi.ts` | ZBI items 1–12 IDs, wording loader, scoring |
| `src/instruments/index.ts` | Registry: each questionnaire's flow, prompts, intro, results text |
| `src/instruments/types.ts` | Shared response/part types |
| `src/questionnaire.ts` | Engine: offers, eligibility, cue, prompts, pause/resume, finish, results |
| `src/answers.ts` | Rule parser + AI interpreter for unclear replies |
| `src/agent.ts`, `src/prompt.ts` | `offer_questionnaire` tool, check-in context, offer safety net |
| `src/index.ts` | Routing: safety → STOP/START → check-in → AI |
| `src/questionnaire.test.ts` | Scoring and flow tests from `LUCIDITY_CONNECT.md` §3.3/§8 |

## Manual test (iMessage)

Start clean: Ctrl+C, `rm data/lucidity.json` (keep `data/instruments/`), `npm run dev`. Wait for `NPI-Q check-ins enabled.`

1. `dad got really agitated at dinner, kept yelling that someone stole his wallet` → normal reply.
2. `another rough night, he was up pacing at 3am and now won't eat breakfast` → reply includes a check-in invitation ending "Reply YES or NO."
3. `yes` → intro + `1/12 — Delusions` (verbatim).
4. Try: `the wallet thing yeah` (→ "Got it: Yes."), `2`, `4`, `no`, `pause` (→ "Paused…"), `resume` (→ same question), `what counts as distress?` (→ explanation + same question re-sent), `idk` (→ "not sure"), `no` for the rest.
5. At the end: "Would you like to see your results…" → `yes` → summary. With an "idk", totals say they aren't calculated (expected).
6. Check `data/lucidity.json` → `assessments[0]`: every response has `questionText` and `rawReply`.
7. Text something normal → back to the AI conversation.

**ZBI** (start clean again, or wait — only one offer per day):
1. `dad was up again last night and honestly I'm so exhausted, I haven't had a minute to myself in weeks` → invitation to a check-in about how caregiving is affecting you.
2. `yes` → intro + `1/12` with the 0–4 scale.
3. Try `pretty often` (→ "Got it: 3."), `every single day honestly` (→ 4), `never`, a question back, then numbers.
4. Results: "Total: X of 48 (higher means more strain)", no categories, plus the helpline.

## Deliberately cut (same engine makes them easy to add)

- Updating a recent check-in instead of retaking (currently: not re-offered within 28 days).
- AD8 (must be asked exactly as written, with its copyright notice).
- The validated ZBI-12 or full ZBI-22: change the item list in `src/instruments/zbi.ts` and the wording file.
- BACK to change the previous answer; a typed "check-in" shortcut.
- Showing past results on request after declining.
