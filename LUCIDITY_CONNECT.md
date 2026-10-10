# Lucidity Connect — Product Requirements Specification

**Version:** 1.0 (hackathon MVP)  
**Date:** 2026-10-10  
**Purpose:** Requirements for caregiver-facing enrollment, assessment administration, Photon messaging, structured records, scheduling, safety, and export to simulated Lucidity Intelligence.  
**Companion:** [Patient Baseline and Personalized Check-ins](LUCIDITY_CONNECT_BASELINE_CHECKINS.md)

> **Status:** Prototype only. Real patient use, administration of copyrighted instruments in modified formats, and any clinical interpretation require additional authorization, validation, privacy/security review, and qualified clinical oversight. **Do not commit real patient data, identifying phone numbers, or Photon secrets.**

## 1. Product goal and boundaries

Lucidity Connect makes it easier for caregivers to share longitudinal observations about Alzheimer's disease and other dementias. A caregiver establishes the patient's personal and functional baseline, then completes brief personalized check-ins through Photon; official assessment data can be collected through authorized means or imported as synthetic test records. Connect preserves response provenance and sends structured data to a simulated Lucidity Intelligence service. The service may return a draft report; a simulated clinician must approve follow-up messages before they are sent.

**In scope for hackathon:** fictional caregiver and patient, enrollment, consent simulation, baseline, tailored text check-in, demonstration assessment flow, synthetic scored AD8/FAQ/NPI-Q/ZBI records, scheduled communication, pause/resume, typed structured events, mock report, approved follow-up.

**Out of scope:** Lucidity Care/physician dashboard specification; real diagnosis or treatment decisions; MoCA/gamified cognitive diagnosis; production EHR and protected-health-information processing; fully validated predictive models; live clinical coverage.

**Priority definition:** P0 = must work in demo; P1 = desirable robust behavior; P2 = production/later.

## 2. Users, enrollment, permissions

| Field | Meaning | Priority |
|---|---|---|
| `patient_id` | Pseudonymous unique ID | P0 |
| `caregiver_id` | Unique respondent ID | P0 |
| `caregiver_patient_link_id` | Specific authorized patient association | P0 |
| `caregiver_relationship` | Child, spouse, friend, professional, other | P0 |
| `caregiver_role` | Primary, secondary, occasional | P0 |
| `patient_display_name`, `caregiver_display_name` | Conversational identifiers; fake in demo | P0 |
| `channel`, `messaging_address` | Supported Photon channel and verified recipient | P0 |
| `timezone`, `preferred_language` | Caregiver time zone and locale | P0 |
| `consent_status`, `opt_in_at` | Explicit messaging consent | P0 |
| `data_sharing_authorization` | Separate authorization for care-team sharing | P0 |
| `care_team_id` | Assigned (simulated) clinical team | P0 |
| `diagnosis_status`, `diagnosis_source` | Clinician-confirmed, reported or unknown | P1 |
| `accessibility_preferences` | Simpler language, alternative web view, etc. | P1 |
| `onboarding_status` | Not started, active, complete, paused | P0 |

**Requirements:** Identity must be associated with every answer. Never equate being a family member with having disclosure authority. Multiple caregivers may report on one patient, but responses (particularly ZBI) remain respondent-specific. Caregiver can update consent, contact preferences, and opt out. Enrollment sequence: verify fictional link/consent -> establish baseline -> offer initial assessments -> schedule check-ins. The profile-before-AD8 sequence is a Lucidity product choice, not a requirement of AD8 itself.

## 3. Instrument registry

Source PDFs provided in project planning:

1. `ad8-dementia-screening.pdf` (3 pages)
2. `functional-activities-questionnaire.pdf` (2 pages)
3. `npiq-questionnaire.pdf` (6 pages)
4. `89-zarit_burden_interview(1).pdf` (2 pages)

Preserve official versions, response categories, source document/version, administration mode and rights status. The following *domain labels and rules* summarize the PDFs and do not reproduce their complete copyrighted item text.

### 3.1 AD8 — 8 cognitive/functional change items

| ID | Domain |
|---|---|
| AD8-01 | Judgment/decision making |
| AD8-02 | Interest in hobbies/activities |
| AD8-03 | Repeated questions/stories/statements |
| AD8-04 | Learning tools/appliances |
| AD8-05 | Month/year orientation |
| AD8-06 | Complex finances |
| AD8-07 | Appointments |
| AD8-08 | Daily thinking/memory |

Response: `YES_CHANGE` = 1, `NO_CHANGE` = 0, `UNKNOWN_NA` = unknown/missing. Total (when properly complete) equals the count of Yes responses, range 0–8. Source lists 0–1 versus >=2 as a **screening** distinction, not diagnosis. An informant is preferred; patient responses can be supported in the appropriate authorized context. Its administration guidelines do not require a fixed period for change. The independent personal baseline must *never* fill answers automatically.

**AD8 requirements:** Keep respondent type and provenance, preserve unknown separately from No, only valid scores, screening language rather than diagnosis; verify express permission before converting the copyrighted PDF to a modified chatbot form.

### 3.2 FAQ — 10 instrumental activities of daily living

| ID | Domain |
|---|---|
| FAQ-01 | Bills/checks |
| FAQ-02 | Financial/tax/business paperwork |
| FAQ-03 | Shopping |
| FAQ-04 | Games of skill and hobbies |
| FAQ-05 | Simple kitchen activities |
| FAQ-06 | Preparing meals |
| FAQ-07 | Current events |
| FAQ-08 | Media comprehension/discussion |
| FAQ-09 | Appointments, occasions, medication |
| FAQ-10 | Travel and transportation |

Map the *distinct original response categories* as follows:

| Category | Score |
|---|---:|
| Normal | 0 |
| Never did, but could now | 0 |
| Difficulty, independently | 1 |
| Never did, would be difficult now | 1 |
| Requires assistance | 2 |
| Dependent | 3 |

Total range 0–30. Source suggests 9 as a threshold indicative of possible functional impairment; not independently diagnostic. **Do not collapse category provenance merely because categories share numeric scores.** Hobby-specific observations may provide context for FAQ-04, but are not official FAQ responses.

### 3.3 NPI-Q — 12 behavioral symptoms (previous month)

| ID | Domain |
|---|---|
| NPIQ-01 | Delusions |
| NPIQ-02 | Hallucinations |
| NPIQ-03 | Agitation/aggression |
| NPIQ-04 | Depression/dysphoria |
| NPIQ-05 | Anxiety |
| NPIQ-06 | Elation/euphoria |
| NPIQ-07 | Apathy/indifference |
| NPIQ-08 | Disinhibition |
| NPIQ-09 | Irritability/lability |
| NPIQ-10 | Aberrant motor behavior |
| NPIQ-11 | Nighttime behavior |
| NPIQ-12 | Appetite/eating |

**Branch per domain:** `present=NO` -> record absent, severity=0/distress=0 (as computed values), continue; `present=YES` -> require severity integer 1–3 and caregiver distress integer 0–5; unknown/incomplete -> retain as missing rather than treating as absent. Separate total severity 0–36 and distress 0–60. **Do not use frequency × severity** (that belongs to a different version of NPI). Standard NPI-Q addresses the preceding month; the custom weekly check-in is not an NPI-Q. The PDF recommends clinician completeness/clarification review.

### 3.4 ZBI-22 — caregiver burden

| Item IDs | Domains |
|---|---|
| ZBI-01–06 | Help demands; time pressure; other responsibilities; embarrassment; anger; relationship effects |
| ZBI-07–12 | Future concerns; dependency; strain; health impact; privacy; social life |
| ZBI-13–18 | Friends/social comfort; exclusive responsibility; costs; sustainability; loss of control; handing care off |
| ZBI-19–22 | Uncertainty; perceived need to do more; perceived adequacy; overall burden |

Answer mapping: Never=0; Rarely=1; Sometimes=2; Quite frequently=3; Nearly always=4. Sum 22 valid items -> total 0–88. **Keep a separate ZBI per caregiver**. Source PDF's suggested cutoff categories overlap at 21; MVP reports continuous numeric values, and does not silently resolve the ambiguous boundary. Do not mix additional support/sleep/workload check-in responses into the official total.

### 3.5 Instrument/response storage

Required assessment fields: `assessment_id`, `patient_id`, `respondent_id`, `respondent_role`, `instrument_code`, `instrument_version`, `instrument_language`, `license_status`, `administration_mode`, `started_at`, `completed_at`, `recall_period`, `item_responses`, `missing_item_ids`, `total_score`, `subscores`, `scoring_version`, `completion_status`, `source`, `review_status`.

Each response: `item_id`, `answer_code`, `answer_value`, `answer_status` (`valid|unknown|skipped|not_asked`), `recorded_at`, `updated_at`, `respondent_id`. Preserve raw category, correction history, and score provenance. Missing, Not Asked, No, and zero are **not interchangeable**. Incomplete forms stay incomplete; do not fabricate final scores. Scoring must use deterministic tested logic, never generated arithmetic from an LLM.

## 4. Photon conversation/session behavior

**Flow:** invitation -> consent/identity context confirmation -> one item/question at a time -> deterministic validation -> persist immediately -> optional correction -> completion confirmation -> structured event -> only authorized follow-up.

**Supported commands/intents:** START, PAUSE, RESUME, BACK, CHANGE, SKIP, STATUS, HELP, STOP, SUPPORT. Recognize flexible wording, but perform deterministic state changes. A STOP must stop future nonessential automated messages.

**States:** `scheduled`, `invited`, `active`, `awaiting_clarification`, `paused`, `completed`, `incomplete`, `expired`, `cancelled`.

**Messaging fields:** `conversation_id`, `message_id`, `sender_id`, `active_workflow`, `active_session_id`, `current_question_id`, `resume_question_id`, `awaiting_response`, `retry_count`, `last_activity_at`, `session_expires_at`, `delivery_status`, `idempotency_key`, `human_handoff_requested`, `escalation_status`.

**Requirements:** do not move ahead on invalid/duplicate messages; associate each answer with an item ID; save progress; correct answers without deleting history; resume from last incomplete item; don't ask an assessment twice accidentally; support failed webhook retry and delivery tracking. Do not treat absent replies as medical findings.

## 5. Scheduling and optional observations

See [baseline and check-ins](LUCIDITY_CONNECT_BASELINE_CHECKINS.md) for content logic. Schedule parameters: `schedule_id`, `caregiver_id`, `patient_id`, `message_type`, `frequency`, `days_of_week`, `local_send_time`, `timezone`, `next_send_at`, `last_sent_at`, `quiet_hours_start/end`, `reminder_interval`, `maximum_reminders`, `status`, `consent_reference`.

Support caregiver-selected daily/weekly/custom check-ins, temporary pauses, frequency changes, and event-triggered reporting. **Never schedule the official NPI-Q as a casual daily questionnaire.** Keep official assessment scheduling and observational questions separate.

Custom observation categories: sleep/nighttime episodes, agitation, confusion/onset, new function assistance, safety/falls/wandering, appetite, medications/illness context, caregiver stress/sleep, respite support, personal preferences, and optionally free-form notes. Every observation needs a source and observation period.

## 6. Connect → simulated Intelligence → clinician-approved Connect follow-up

Connect event fields:

```json
{
  "event_version": "1.0",
  "patient_id": "P001",
  "caregiver_id": "C001",
  "data_kind": "synthetic",
  "assessment_results": {
    "zbi": {"previous": 31, "current": 49},
    "npiq": {"severity_previous": 9, "severity_current": 14, "distress_previous": 16, "distress_current": 24},
    "faq": {"previous": 12, "current": 18}
  },
  "observations": [{"type": "nighttime_disruption", "value": 5, "unit": "nights_per_week", "source": "caregiver"}],
  "review_required": true
}
```

Production schema also needs item-level responses, evidence IDs, baseline references, timestamp/reference periods, completed/missing states, assessment version, and data-quality flags.

The **mock** Intelligence reply may include `summary`, `detected_changes`, `associated_findings`, `evidence_ids`, `missing_information`, `draft_followup_actions`, `safety_flags`, and `requires_clinician_review`. Never claim correlation is causation. Connect delivers only a verified `caregiver_message` associated with `review_status`, `reviewer_id`, `approved_actions`, and `approved_at`. In demo, clearly label clinicians as simulated.

## 7. Safety, accessibility, privacy, rights

- Do not collect or upload real patient data for this hackathon. Preserve simulated consent and access boundaries.
- Never commit `.env` or credentials. The existing repository uses Photon/Spectrum and `.env` for its credentials; do not read, copy, or log them.
- Verify recipient/permission; avoid medical details in unprotected messaging; production handling requires appropriate security agreements and care-team governance.
- Offer opt-out, correction, non-response, and human-support paths. Accessibility and clear language are especially important for older caregivers.
- Detect reported sudden/worsening confusion, injuries, or immediate danger through predefined prompts and advise appropriate timely medical/emergency help; do not offer autonomous diagnosis or guarantee someone is watching messages 24/7.
- An AI-generated report or follow-up is a **draft** unless approved by an actual licensed clinician in a real service.
- Uploaded AD8 grants only restricted exact reproduction for stated uses; NPI-Q is copyrighted and its PDF restricts certain for-profit research use; FAQ educational handout grants specified full-document educational reproduction; ZBI digital license requires verification. **Do not publish the original PDFs or their full question text to this public repository without suitable rights**. Modified conversational administration may require rights and validation.

## 8. MVP acceptance criteria

| Test | Expected behavior |
|---|---|
| Fictional enrollment | Correct separate IDs, recipient, consent, timezone, patient link |
| Baseline completed | Hobbies and historical abilities retained with provenance |
| Custom check-in | One user-specific hobby question and recorded response |
| Missing/unknown reply | Never silently becomes negative/zero |
| AD8 scoring | Only Yes counted, 0–8, unknown retained |
| FAQ category | Two never-did types preserve distinct codes even if same score |
| NPI-Q no symptom | Skip severity/distress and score domain absent |
| NPI-Q present symptom | Validate severity 1–3 and distress 0–5 |
| NPI-Q overall | Separate severity and distress totals |
| ZBI total | Sum 22 validated responses, respondent-specific |
| Interrupted session | Correct pause/resume, no data loss |
| Correct an answer | Recomputed deterministic score; correction history |
| Duplicate webhook | Exactly one processed response |
| STOP | Nonessential messages cease |
| Safety event | Reviewed safety messaging/handoff, not invented diagnosis |
| Mock Intelligence | Receive versioned payload with original evidence references |
| Mock clinician approval | Follow-up only dispatched after approval state |

## 9. Definition of done

The team can run one **end-to-end fictional scenario**: enroll caregiver and patient; establish an activity baseline; receive/answer an adaptive Photon check-in; import and score two synthetic assessment timepoints; display mocked Intelligence output; simulate clinical approval; message a follow-up; demonstrate pause/resume, STOP and input validation.

**Build boundary:** Connect collects trustworthy, attributable information. Interpretation and clinical treatment remain outside Connect.
