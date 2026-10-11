# Phase 5 — Close the Loop (Intelligence + Care + Connect)

Branch `phase-5-close-the-loop`. The full loop now runs over iMessage with two phones:

```
Connect collects ──▶ Intelligence compiles ──▶ Care reviews and approves ──▶ Connect delivers
(caregiver texts)     (profile, by code)        (clinician phone)            (to the caregiver, reply saved)
        ▲                                                                              │
        └──────────────────────────── the caregiver's reply restarts the loop ─────────┘
```

| Pillar | What was added | File |
|---|---|---|
| **Intelligence** | One-page profile compiled by code: NPI-Q changes between check-ins (per symptom + totals), ZBI items that rose, the caregiver's own words, lucid moments, safety alerts, and rule-based suggested questions (each with a "why") | `src/profile.ts` |
| **Care** | Clinician texts from `CLINICIAN_PHONE`, in natural phrases (any capitalization): "profile" / "how is he doing?", "ask 1", "ask them: …", "tell them: …", "send it" / "looks good", "change it to …", "never mind", "any replies?", "help". Exact keywords (`PROFILE`, `ASK`, `RECOMMEND`, `APPROVE`, `EDIT`, `CANCEL`, `STATUS`) still work. Rule-based, no model. Safety alerts and "new update" nudges go to the clinician | `src/care.ts` |
| **Connect** | Delivers the approved text exactly ("Question from Dad's care team: …" / "From Dad's care team: …"), saves the caregiver's reply linked to it (caregiver-reported, not verified), forwards it to the clinician | `src/care.ts`, `src/index.ts` |

## The rules

- **Nothing reaches the caregiver until the clinician approves the exact text.** The clinician sees the final wording before APPROVE.
- Clinician texts are never treated as caregiver messages (no safety triage, no AI).
- Not sent if the caregiver has opted out (STOP); the clinician is told.
- The caregiver's first message after a care-team message is saved as the reply. Short YES/SKIP answers are acknowledged by code; longer answers go to the AI with a note (so it records anything reported, thanks them, and adds no advice), and are forwarded to the clinician.
- Clinician nudges: "New update for Jonathan: … Reply PROFILE." — after a check-in completes (always), or when a new behavior is reported (at most once an hour).
- Safety alerts (rules or AI) go to `CARE_TEAM_PHONE`, else `CLINICIAN_PHONE`, with the caregiver's words and the time fixed guidance was sent.
- One patient per caregiver; the clinician works with the most recently active caregiver (or `DEMO_CAREGIVER_PHONE`).

## Setup

1. In `.env`: `CLINICIAN_PHONE=+1…` (the teammate's phone). The number must be under **Users** in the Photon dashboard; we verified Emergy's number works (it took a few minutes to activate after adding).
2. The clinician texts **their own assigned Lucidity line** (the  number next to their name under Users), not the caregiver's.
3. Startup logs `[lucidity] Care enabled: clinician commands from CLINICIAN_PHONE.`

## Demo data (synthetic Jonathan)

Stop the bot first (it rewrites `data/lucidity.json` from memory). The caregiver phone must have texted Lucidity at least once.

```bash
npm run demo:seed            # September baseline only: do the live NPI-Q/ZBI in the demo as "October"
npm run demo:seed -- --full  # also synthetic October check-ins + 3 caregiver messages (fully scripted profile)
```

Seeds: patient "Jonathan" (caregiver calls him "Dad"); September NPI-Q severity 6/36, distress 8/60 (anxiety 1, wandering 1, low mood 1, night-time 1, apathy 2); ZBI items 1–12 total 13/48. `--full` adds October NPI-Q 12/36, 18/60 (anxiety 3, wandering 3, low mood 2, night-time 2, apathy 2) and ZBI 24/48 (10 of 12 items rose). Everything is labeled synthetic.

## Demo script (two phones)

Caregiver phone = your phone. Clinician phone = teammate ("Simulated clinician"). Run `npm run demo:seed -- --full`, then `npm run dev`.

| # | Who | Text | Result |
|---|---|---|---|
| 1 | Caregiver | `dad is so anxious tonight. he keeps trying to get up and leave.` | Normal Lucidity reply; clinician gets "New update for Jonathan… Reply "profile" to review." |
| 2 | Clinician | `how is he doing?` | The one-page profile (changes Sept → Oct, caregiver's words, suggested questions) |
| 3 | Clinician | `ask 1` | Draft: "Question from Dad's care team: Does Dad's anxiety tend to happen at a particular time of day…" |
| 4 | Clinician | `send it` | Caregiver receives it |
| 5 | Caregiver | `usually right after dinner` | Lucidity thanks them; clinician gets "Caregiver replied…" |
| 6 | Clinician | `tell them: create a calm environment and remove environmental triggers` | Lucidity drafts caregiver-friendly wording (e.g. "Dad's anxiety sounds really hard tonight. One thing that can help is making his space calm… Want to try it? Reply YES, or skip.") and shows the clinician's note under it |
| 7 | Clinician | `looks good` (or `use my words` to send the note as typed, or `change it to: …`) | Caregiver receives "From Dad's care team: …" exactly as approved |
| 8 | Caregiver | `yes` | "Thank you. I've let Dad's care team know you'll try it."; clinician gets the reply |
| 9 | Caregiver | `he fell and hit his head` | Instant fixed 911 text; clinician gets "⚠ Lucidity EMERGENCY alert for Jonathan…" |
| 10 | Clinician | `any replies?` | Messages sent and replies |

Other phrases: "change it to: …" (edit the draft), "never mind" / "don't send it" (cancel), "help". Unrecognized text gets a short hint, never the AI.

## What's still simulated

- The clinician is a teammate labeled "Simulated clinician"; September/October data is synthetic.
- Profile wording is templated by code; suggested questions are simple rules. Only the caregiver-facing wording of clinician notes is AI-drafted (and always approved by the clinician).
- No "at most one care-team message per day" limit enforced (requirements RET8) so the demo can show a question and a recommendation.
