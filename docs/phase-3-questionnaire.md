# Phase 3 — Questionnaire Handoff (NPI-Q)

Branch `phase-3-questionnaire`. Lucidity now has two modes:

- **AI conversation** (Phase 2): free-form texting, saves observations, notices cues.
- **Questionnaire mode** (new): the NPI-Q asked **word for word**, one prompt at a time, answers stored with the exact text shown, **scored by code**. Then control returns to the AI.

Like a website chatbot handing you to a specialist: the AI offers, the caregiver says YES, the questionnaire takes over, then hands back.

```
caregiver ─▶ safety rules (always first) ─▶ check-in in progress? ─yes─▶ questionnaire mode (code)
                                              │ no
                                              ▼
                                         AI conversation ──offer──▶ YES ──▶ questionnaire mode
```

## Setup

The NPI-Q wording is copyrighted and this repo is public, so it is **not committed**. It lives in a git-ignored file:

```
data/instruments/npiq.local.json
```

A blank template showing the format is in [instruments/npiq.example.json](instruments/npiq.example.json). Copy it to the path above and fill in the wording from the licensed PDF (`data/alzheimers_test_pdfs/npiq-questionnaire.pdf`, also git-ignored). At startup the bot logs either `NPI-Q check-ins enabled.` or `NPI-Q check-ins disabled (...)`.

Wording notes: question text is verbatim from the PDF except (a) "Circle" in the instructions became "Answer" for text messaging, and (b) a PDF text-extraction typo "Doeshe/she" was written "Does he/she".

## How it works

**Offering (AI side)**
- Code detects the cue: **2+ different NPI-Q symptom domains recorded in the past 7 days** (`cueMet` in `src/questionnaire.ts`), and tells the AI "CUE MET — offer it now". The AI may also offer if the caregiver asks for a fuller check-in.
- The AI calls `offer_questionnaire` and writes a short invitation ending "Reply YES or NO." If it writes the invitation but forgets the tool, code records the offer anyway.
- Not offered if: already in progress or paused; an NPI-Q was completed in the last **28 days** (the NPI-Q covers the past month); declined in the last **7 days**; or already offered today.

**Questionnaire mode (code side)**
- Intro names who it's about ("the patient" = Dad) and says: **Reply SKIP to skip, PAUSE to pause, RESUME to continue.**
- For each of 12 domains: YES/NO → if YES, severity (1–3) → distress (0–5), using the PDF's scale wording.
- Answers: clear replies are parsed by rules ("yeah", "nope", "2"). Unclear replies go to the AI interpreter, which either maps them ("the wallet thing yeah" → Yes, confirmed back as "Got it: Yes.") or writes one short clarification, after which code **re-sends the exact question**. Two unclear replies → marked unknown, move on.
- "idk" / "not sure" → **unknown, never No**. SKIP → skipped.
- An emergency message mid-check-in gets the safety reply and **pauses** the check-in. STOP also pauses it.
- Check-in replies are handled immediately (no 10-second burst wait).

**Finishing**
- Scores by code: total severity (0–36) and total distress (0–60), reported separately. **If any answer is unknown or skipped, the status is `incomplete` and no totals are calculated** (no fabricated scores).
- First time only: "Would you like to see your results, now and after future check-ins?" — the answer is remembered.
- A marker is added to chat history so the AI knows the check-in happened; the AI only sees scores if the caregiver consented.

## Stored data (`data/lucidity.json` → `assessments`)

Each check-in: instrument, version, `administrationMode: imessage_verbatim`, recall period, respondent, patient label, status (`in_progress` / `paused` / `completed` / `incomplete`), timestamps, and per response: `itemId`, `part` (presence/severity/distress), **the exact `questionText` shown**, the caregiver's `rawReply`, `value`, `status` (valid / unknown / skipped / not_asked), and `interpretedBy` (rule / llm / system). Scores include `scoringVersion`, per-domain results, and `missingItemIds`.

## Files

| File | What |
|---|---|
| `src/instruments/npiq.ts` | Item IDs/domains, wording loader, scoring (no copyrighted text) |
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

## Deliberately cut (same engine makes them easy to add)

- Updating a recent check-in instead of retaking (currently: not re-offered within 28 days).
- AD8 (must be asked exactly as written, with its copyright notice) and ZBI items 1–12.
- BACK to change the previous answer; a typed "check-in" shortcut.
- Showing past results on request after declining.
