# Lucidity Connect — Patient Baseline & Personalized Check-in Requirements

**Status:** Hackathon MVP addendum • 2026-10-10  
**Parent:** [Lucidity Connect requirements](LUCIDITY_CONNECT.md)

## 1. Design intent

Before presenting initial assessments, Lucidity offers a brief conversational baseline to learn **who the person is**: what activities they enjoyed, what they could do independently, current preferences, typical routines, and when/how changes were noticed. This history personalizes later check-ins and gives context for the FAQ's hobby/functional domains and the AD8's change-oriented screening.

**Instrument integrity:** This is *not* a validated assessment, cannot generate AD8 or FAQ scores on its own, and is not clinically required before official AD8 administration. The onboarding order is a Lucidity design choice. Never substitute personalized questions for official test questions, and never treat stopping an activity as proof of dementia-related impairment.

## 2. Baseline intake topics and fields

### Identity, enjoyable activities, and preferences

Collect historical and current favorites: hobbies, games, sports, music, television, books, social routines, meaningful relationships, preferred routines, disliked or upsetting activities. Use open questions first; ask limited follow-ups for unclear responses.

**Per activity:**

| Field | Purpose |
|---|---|
| `activity_id`, `activity_name`, `activity_category` | Unique, caregiver-defined activity and optional tag |
| `historical_preference`, `current_preference` | Enjoyment and personal significance, independently recorded |
| `historical_frequency`, `current_frequency` | Approximate participation frequency, if known |
| `historical_ability`, `current_ability` | Able independently, with difficulty, needs help, unable, unknown |
| `last_known_participation` | Date/approximate period |
| `stopped_reason_reported` | Lost interest, difficult, physical problem, schedule/access, unknown, other |
| `caregiver_notes`, `source` | Report and provenance |

**BASE-001:** Up to three activities in MVP; no need to complete a long profile in one session. **BASE-002:** Ask separately *whether they enjoy it* and *whether they can perform it*. **BASE-003:** Allow unknown and never-performed, rather than assuming decline. **BASE-004:** Never force caregiver to invent a specific date or reason.

### Historical functional abilities

Capture contextual historical and current ability concerning managing finances, shopping, preparing food, appointments/medication, household responsibilities, games/hobbies, news/media comprehension, using devices, and transportation. Store individual domains and whether the person **ever performed** them.

Fields: `functional_domain`, `historical_ability`, `current_ability`, `historical_participation`, `change_observed`, `estimated_change_onset`, `contributing_factors_reported`, `confidence`, `source`, `last_updated_at`.

**BASE-005:** Preserve the FAQ's never-did distinctions as contextual history without automatically deciding the questionnaire response. **BASE-006:** Physically inaccessible activities or lack of opportunity must not be automatically interpreted as cognitive decline.

### Daily routine, environment, and relationships

Capture optional wake/sleep pattern, typical meals, usual social contacts, hobbies by time of day, living situation, available help, mobility/sensory constraints, language, and activities associated with comfort or distress. Respect minimal collection: only capture what helps care and messaging.

### Baseline provenance/versioning

`baseline_id`, `patient_id`, `respondent_id`, `recorded_at`, `period_described`, `source_type`, `verification_status`, `last_updated_at`, `version`, `prior_version_id`.

**BASE-007:** Separate caregiver-reported historical recollections from verified records. **BASE-008:** Allow corrections and preserve versions; a new report should not silently rewrite prior observations. **BASE-009:** Allow patient voice/preferences where appropriate and feasible.

## 3. Conversational baseline workflow

1. **Invite:** explain that the purpose is personalized support, not a diagnostic quiz. Ask consent and permission to talk about the linked fictional patient.
2. **Open question:** ask which activities the person previously loved.
3. **Clarify:** extract an activity record; repeat back in plain language for confirmation, rather than presuming a classification.
4. **Compare:** ask whether they still enjoy it and whether they still can do it.
5. **Context:** if they stopped, ask caregiver-perceived reason, onset, whether this reflects inability vs preference vs opportunity.
6. **Limit burden:** offer to save after a few activities, pause, or skip.
7. **Confirm:** summarize baseline and allow corrections.
8. **Continue:** offer appropriate initial instrument through an authorized channel, then configure optional check-ins.

Illustrative original (non-test) interaction:

> **Lucidity:** Which activities has your father especially enjoyed over the years?  
> **Caregiver:** Gardening, chess, reading the paper.  
> **Lucidity:** Does he still do those activities?  
> **Caregiver:** He still gardens but has stopped chess.  
> **Lucidity:** Does he no longer enjoy chess, does it seem harder now, or is there another reason?  
> **Caregiver:** He has trouble remembering how the pieces move.  
> **Lucidity:** I'll save that as an observation about chess, not a test result. You can correct this anytime.

Do not quiz the patient or caregiver harshly, claim a cognitive diagnosis, or fabricate personal history.

## 4. Personalized check-in rules

**CHECK-001:** A caregiver may schedule optional daily, weekly, or customized brief conversations at their selected local time; quiet hours, pause, change frequency, reminders, STOP, and skipping must work. **CHECK-002:** Each interaction asks only a small subset of relevant questions, based on recent observations and baseline, not the full catalog.

| Category | Example structured fields | Related official domains (context only) |
|---|---|---|
| Enjoyed activities | Activity attempted, enjoyment, independence, assistance, why not | FAQ-04; AD8-02 |
| Meal preparation | Assistance, new difficulty, safety observations | FAQ-05/06 |
| Finances/appointments | Newly needed help | FAQ-01/09; AD8-06/07 |
| Nighttime behavior | Nights affected, awakenings, change from usual | NPIQ-11 |
| Agitation/irritability | Occurrence, approximate frequency, context | NPIQ-03/09 |
| Confusion | Onset sudden/gradual/unknown; baseline change | Context; safety triage |
| Eating | Appetite or meal changes | NPIQ-12 |
| Caregiver wellness | Stress, sleep, working hours, emotional load | ZBI-related, **not ZBI score** |
| Help/respite | Support available, support requested | Care coordination |
| Safety events | Falls, wandering, missing person, immediate concerns | Safety workflow |

**CHECK-003:** When a change is reported, optionally collect when it began, what it looks like, approximate frequency, how it affected patient or caregiver, and what assistance is needed. **CHECK-004:** Maintain *separate* patient-wellbeing, caregiver-wellbeing, function, behavior, and external-context fields. **CHECK-005:** Observations must be linked to but never automatically replace official assessment responses.

Observation schema:

```json
{
  "observation_id": "O1001",
  "patient_id": "P001",
  "caregiver_id": "C001",
  "activity_id": "ACT-CHESS",
  "type": "activity_ability_change",
  "change_direction": "worse",
  "current_ability": "needs_assistance",
  "reason_reported": "difficulty_remembering_rules",
  "observed_period": "this_week",
  "reported_at": "2026-10-10T15:00:00-04:00",
  "respondent_role": "caregiver",
  "source": "caregiver_text",
  "official_instrument_response": false
}
```

## 5. Example adaptive logic (not medical inference)

- Historical gardening + still enjoyed → next relevant check-in may ask whether gardening participation is as usual, now needs help, or did not happen; **do not assume impairment if not attempted**.
- Historical chess + difficulty with game rules → follow up on observed impact and onset if caregiver wishes; tag as context for FAQ-04/AD8-02, **not an automatically scored answer**.
- Nighttime interruptions increasing → collect number of affected nights and impact on caregiver sleep; compare with prior reports; keep separate from monthly NPI-Q severity/distress scores.
- Stable patient behavior + worse caregiver stress → record external burdens or lower support if caregiver volunteers them; avoid claiming the patient caused caregiver distress.
- Sudden marked confusion or other potential medical emergency → stop routine question path and present predetermined urgent medical-help guidance/handoff, with no autonomous diagnosis.

## 6. Scheduling and engagement controls

Fields: `checkin_id`, `patient_id`, `caregiver_id`, `checkin_topics`, `frequency`, `preferred_days`, `local_send_time`, `timezone`, `quiet_hours`, `next_checkin_at`, `last_checkin_at`, `status`, `reminder_count`, `consent_reference`.

**CHECK-006:** Short invitation with purpose; no repeated pings after opt-out. **CHECK-007:** The caregiver can choose when and how often to participate, as well as pause and resume. **CHECK-008:** No answer means missing, not absence of symptoms. **CHECK-009:** Protect the difference between direct observation, caregiver interpretation, and historical recollection. **CHECK-010:** Every observation saves respondent/time/source. **CHECK-011:** Include patient comfort and preferences, not only deterioration.

## 7. Assessment mapping and reporting boundaries

| Lucidity observation | Related item(s), for review only |
|---|---|
| Reduced enjoyment of hobbies | AD8-02 |
| Difficulty playing a familiar game | FAQ-04 |
| New difficulty paying bills | AD8-06, FAQ-01 |
| Missed appointments | AD8-07, FAQ-09 |
| Trouble preparing meals | FAQ-06 |
| Night waking | NPIQ-11 |
| Irritability | NPIQ-09 |
| Caregiver feels overwhelmed | Related ZBI concerns but not an official item |

The *relationship* is useful for simulated Intelligence review, but cross-mapping does **not** calculate, prefill, or modify official assessment scores. Do not label routine check-ins as standardized AD8/FAQ/NPI-Q/ZBI administrations.

## 8. Acceptance criteria

| Test | Expected result |
|---|---|
| Add gardening, chess, reading | Three distinct activity records saved |
| Previously never cooked | Historical never-performed distinguished from loss of skill |
| Stops hobby due to disinterest | Preference change without automatic cognitive impairment |
| Stops hobby due to difficulty | Ability-change record, separately from enjoyment |
| Caregiver doesn't know why | `unknown` saved, no invented rationale |
| Respondent edits a statement | Previous version retained; current corrected |
| Check-in selects chess | References recorded personal history without official test wording |
| Reports nights waking increased | Structured nighttime event with observation period |
| Caregiver pauses mid-onboarding | Progress saved and resumable |
| Caregiver declines check-in | No coercive reminders; can opt out |
| Sudden severe confusion reported | Safe predetermined medical follow-up guidance |
| Data passed to mock Intelligence | Evidence/source IDs preserved, no fictitious diagnosis |

**MVP done:** a fictional caregiver can create a patient history of several activities and abilities, receive one Photon personalized check-in, answer/skip/correct it, and have the observations reliably stored and linked for mock intelligence review. All identity, consent and medical-safety limitations remain explicit.
