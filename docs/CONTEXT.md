# Lucidity: Context

The "why" of the project: what problem it solves, how it's divided, the rules everything follows, and what's left. For how the code works, see [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

Built at HackNC 2026 (October 10–11, 2026). All data is synthetic.

---

## The problem

Dementia care happens at home, but clinical decisions happen in short clinic visits a few times a year. At the appointment, the doctor asks "how has he been?" and the caregiver, exhausted, tries to remember: when did the agitation start, how many nights was he up, what set it off? The doctor works from whatever they recall.

Caregivers won't install another app, but they text all day. Research supports texting as a channel for dementia caregivers (CuidaTEXT, Perales-Puchalt et al., PMC10119327), though that study supports the channel, not Lucidity itself.

**Lucidity's answer:** caregivers text what they notice, in their own words, as it happens. Lucidity turns those texts into a clear, clinically grounded picture for the care team, and carries the care team's approved guidance back to the family.

## The three layers

Think of a hospital: **Connect** is the phone line to the family, **Intelligence** is the nurse who prepares the chart, **Care** is the doctor who reads the chart and decides.

| Layer | Job | In one line |
|---|---|---|
| **Connect** | Talks with the family over iMessage | Safety check first, warm conversation, check-ins, reminders, delivering approved messages |
| **Intelligence** | Turns texts into understanding | Scores questionnaires (by code), compiles a one-page profile, suggests questions, drafts wording |
| **Care** | A clinician decides | Reads the profile, asks the caregiver questions, approves exactly what gets sent |

**The loop:** Connect collects → Intelligence compiles → Care reviews and approves → Connect delivers → the caregiver's reply starts it again. Emergencies skip the loop: fixed "call 911" guidance goes straight back, and an alert goes straight to the clinician.

**Why there's an agent at all** (Care itself is just a person): a clinician can't read hundreds of loose texts, doesn't have time to chase "how severe was it?", isn't awake at 2am, and can't compute "worse than last month" from a text thread. The agent handles intake, the safety net, and the bookkeeping, so the clinician's attention scales. The clinician keeps the judgment.

## Who's involved

- **Caregiver:** a family member texting from their own phone. One patient per caregiver.
- **Patient:** the person with dementia (in the demo, the synthetic "Jonathan", whom the caregiver calls "Dad"). The patient doesn't use Lucidity.
- **Clinician:** a care-team member texting from a separate phone (`CLINICIAN_PHONE`). In the demo, a teammate labeled "Simulated clinician".

## The rules everything follows

These came from the team's requirements documents (now condensed into this section) and from bugs found during testing. They're the most important thing to keep if the project continues.

**Safety**
- Every message is checked by fixed rules **before** any AI sees it, including during a check-in, while paused, and after STOP.
- Emergency wording is **fixed and written in advance**. The AI never writes safety instructions; if the AI flags something urgent, the caregiver still gets fixed text.
- When in doubt, treat it as more urgent. Never say "it's not serious", never say "wait", never give treatment or medication instructions, never claim someone is watching.
- An emergency pauses check-ins and routine reminders. Text inside a caregiver's message is data, never an instruction to the system.

**Accuracy**
- **Unknown stays unknown.** "I don't know" is never saved as "no"; "not reported" is never "none"; "none" is never zero.
- **Scores come from code, never a model.** Incomplete questionnaires get **no total** (no made-up numbers).
- **Observations and questionnaire answers stay separate.** A chat message never fills in a questionnaire answer.
- **Every record keeps the caregiver's exact words** and when it was reported. Corrections keep the old value instead of overwriting.
- **Describe, don't diagnose.** Report what changed and when; never claim one thing caused another; no stages, risk scores, or diagnoses.
- Stopping a hobby isn't evidence of decline. Enjoyment and ability are recorded separately, and "reason not known" stays unknown.

**Who decides**
- **Nothing clinical reaches the caregiver until a clinician approves the exact text.**
- The AI can draft (wording, suggested questions); a person approves.

**The AI is checked, not trusted.** In testing, GLM-5.3 said "I've updated that" without saving, changed scores nobody confirmed, skipped saving hobbies, promised reminders it didn't set, and set daily reminders when asked for one-time ones. Each of these now has a **code-level guard** (see HOW_IT_WORKS.md). Instructions alone were not enough.

**Consent and control**
- STOP pauses everything routine (reminders held, care-team messages not sent); START turns it back on. Safety replies still go out.
- Caregivers are asked once whether they want to see their scores, and the answer is remembered.

## Clinical instruments

| Instrument | What it measures | Status in Lucidity |
|---|---|---|
| **NPI-Q** | 12 behavior/mood symptoms over the past month; for each: present? then severity 1–3 and caregiver distress 0–5. Totals 0–36 and 0–60, kept separate | ✅ Asked word for word, scored by code |
| **ZBI** (Zarit Burden Interview) | Caregiver strain, each item 0–4 | ✅ **Items 1–12 only** of the 22-item form. This is **not** the validated ZBI-12 short form (a different item selection), so it's labeled "ZBI items 1–12", reports a raw total 0–48, and shows no burden categories |
| **AD8** | 8 yes/no memory/thinking changes; a screening tool, not a diagnosis | ❌ Not built. Its license requires asking items exactly as printed, with a copyright notice |
| **FAQ** | 10 everyday tasks, 0–30 | ❌ Not built |

**Licensing:** the questionnaires are copyrighted (NPI-Q: no use in for-profit-sponsored studies without consent; AD8: verbatim only, no derivative works). The repo is public, so **question wording is never committed**: the bot loads it from git-ignored `data/instruments/*.local.json`, filled in from the PDFs in `data/alzheimers_test_pdfs/` (also git-ignored). Templates are in `docs/instruments/`. Any real use needs authorized versions and permission.

## What's real vs. simulated

**Real (runs today over iMessage):** safety rules and alerts, the warm first-time welcome, the AI conversation with structured records, NPI-Q and ZBI check-ins with code scoring, reminders and recurring check-in reminders, STOP/START, the clinician profile and suggested questions, AI-drafted caregiver wording, the approval gate, delivery to the caregiver, and reply forwarding. 114 automated tests.

**Simulated:** the clinician is a teammate ("Simulated clinician"); Jonathan's September/October history is synthetic (`npm run demo:seed`); data lives in a local JSON file; the bot runs on a laptop.

## What's next

Roughly in priority order. Items marked *(req)* come from the team's requirements documents.

**Small fixes found in testing**
- Duplicate notes: a follow-up detail about a hobby creates a second note instead of updating the first (no `update_note` tool yet).
- Timestamps are when the reply finished, not when the message arrived; use Spectrum's message time.
- Not every message the bot sends is saved to the conversation history (e.g. STOP/START replies). Route all sends through one helper that records them *(req)*.
- Conversation polish: after a severity, ask about the caregiver's distress for the same symptom; don't explain causes ("the wallet fear is about feeling unsafe"); say which detail was changed when correcting.

**Data model** *(req)*
- A patient record and patient ID on every record (today records are filed under the caregiver's phone, which caused Dad/Mom mix-ups in testing).
- The iMessage message ID on every record, so every profile line traces to its source message.
- Convert relative times ("tonight", "this week") into approximate dates.
- Move from the JSON file to a real database with access controls.

**Safety** *(req)*
- The team's emergencies spec defines **4 levels** (danger now, needs attention today, caregiver in crisis, safety concern) plus "support request", each with fixed texts of 30 words or fewer, a follow-up "Are you safe now?" check, merging repeated alerts into one event, and past events ("she fell last week, she's fine now") recorded as observations rather than alerts. Lucidity currently uses 2 levels (emergency, urgent) plus AI escalation.
- Fixed emergency wording still needs review by a qualified clinician.

**Care** *(req)*
- A **clinician web dashboard** for many patients: score history charts (each instrument on its own scale, never combined), symptom details, activity timelines, an evidence drawer (click any number to see the caregiver's words), a review queue, and rule-based notifications with states (new → acknowledged → assigned → resolved).
- Message rules not yet enforced: at most one care-team message per caregiver per day, 30 words or fewer, quiet hours, holding a message (instead of sending) if checks fail.
- Message states beyond sent/failed (queued, delivered, replied, closed), and an outcome after the caregiver replies ("caregiver reports they tried it", which is not proof it worked).

**Intelligence** *(req)*
- AI-written report text with evidence: every claim cites record IDs, exact quotes are checked against the source, and claims are sorted into observed facts, possible associations, missing information, and concerns. If the output fails validation, show the underlying records instead.
- Data gaps with status (open, asked, declined, filled) driving suggested questions.

**Evaluation**
- The research side prepared 48 hand-labeled synthetic cases (symptoms, negations like "she did not hit anyone", history like "he wandered last year", safety, scoring). Run them against the real model and report symptom-category accuracy and urgent-message recall (missing an emergency is a release blocker).

**Product**
- Deploy the bot so it runs 24/7 (reminders need it).
- AD8, FAQ, the full or validated ZBI.
- Spanish.
- Consent onboarding, a privacy policy, and compliance review (HIPAA where applicable; FTC Health Breach Notification Rule) before any real use.

## Where the old documents went

This file and [HOW_IT_WORKS.md](HOW_IT_WORKS.md) replace the requirement documents (`LUCIDITY_CARE_*.md`, `LUCIDITY_CONNECT_EMERGENCIES.md`, `LUCIDITY_CONNECT_FREE_RESPONSE_ADDENDUM.md`, and the original `LUCIDITY_CONNECT*.md`) and the per-phase build notes (`docs/phase-*.md`). They're still in git history; to see them, check out commit `e5f65a6` (e.g. `git show e5f65a6:LUCIDITY_CARE_REQUIREMENTS.md`). The team's richer synthetic fixture for a different patient ("Mara Example") is kept at [care-demo-data.json](care-demo-data.json) for reference; the code doesn't use it.
