# Lucidity Care Profile Requirements

Version 1.1, October 10, 2026. Synthetic hackathon demonstration only.

These are hackathon requirements, not clinically validated rules. A qualified clinician must review them before any real use. All demo data is synthetic and uses fake phone numbers.

## 1. Purpose and scope

For the hackathon, Care is not a dashboard. Care is three things:

1. A profile for each patient, built from the categories Connect already stores.
2. A plain way for a clinician to read the profile, and scripted demo feedback that stands in for the clinician's response.
3. A return message that carries an approved response back to the caregiver through the caregiver's account.

This file replaces the dashboard and chart parts of the earlier Care requirements (version 1.1) for the hackathon. The data contract parts of version 1.1 still apply: the shared record envelope, the evidence rules, and the rules against scoring from missing data. Charts, chart accuracy, the full review queue, and a clinician login are deferred.

In scope:

* A category dictionary that matches what Connect stores today.
* A profile per patient that clinicians can reach.
* One text page and the same data as JSON for looking at it. No charts.
* Room in the profile for the answers to four questionnaires: AD8, FAQ, NPIQ, and ZBI22 (items 1 to 12 only).
* A scripted demo scenario, from start to finish, that stands in for clinician feedback.
* A return message sent through the caregiver's account.

Out of scope: charts, computed scores, a full interface, real clinician access, real patient data.

## 2. Rules that always apply

* G1 The profile is derived. It is never typed by hand. Rebuilding it from the same records gives the same profile.
* G2 Every line in the profile points to the records, and the caregiver's own words, that it came from.
* G3 Unknown stays unknown. Not reported is not none, and none is not zero.
* G4 A domain label is Lucidity's match of the caregiver's words to a category. It is shown as assigned, not confirmed. Severity and distress are the caregiver's own numbers.
* G5 No totals, stages, risk levels, or diagnoses. Describe what was reported and when. Describe overlap in time, never cause.
* G6 Everything the profile compiler drafts, and every message in the demo, is a draft until a person approves it. The clinician in the demo is simulated and scripted, and is labeled that way.
* G7 Safety statements create alerts. They are never turned into symptom records.
* G8 The profile never shows a raw phone number. Demo data uses fake numbers, and real numbers are never committed.

## 3. Category dictionary

This is what Connect stores today. Field names below match the code.

Every record has:

* `id`, and `caregiver`, the account the message came from.
* `quote`, the caregiver's exact words.
* `observedPeriod`, the period the caregiver described, as free text.
* `reportedAt` and `updatedAt`.
* `source`, which is `caregiver_text`.
* `revisions`, a list holding the earlier values of any field that changed, with the time.

Record kinds and their categories:

* `npi_observation`
  * `domain`: delusions, hallucinations, agitation_aggression, depression_dysphoria, anxiety, elation_euphoria, apathy_indifference, disinhibition, irritability_lability, aberrant_motor_behavior, nighttime_behaviors, appetite_eating.
  * `severity`: 1 mild, 2 moderate, 3 severe, or not reported.
  * `distress`: 0 to 5, the caregiver's own, or not reported.
  * `followupDeclined`: true when the caregiver skipped the question.
* `lucidity_episode`
  * `duration`, `context`, `whatWasSaidOrDone`, `afterState`: each text, or not reported.
  * `followupDeclined`.
* `general_note`
  * `topic`: activity_or_hobby, daily_function, caregiver_wellbeing, medical_context, positive_moment, other.
  * `summary`: one plain sentence of what was reported.
* `alert`
  * `level`: emergency or urgent.
  * `source`: rules or ai.
  * `reasons`: category names when the source is rules, free text when the source is ai.
  * `text`: the message that caused it, and `at`.

What empty values mean:

* `severity` or `distress` not reported: the caregiver has not said. Do not treat it as 0.
* A domain with no record: not reported. It is not confirmed absent. Connect never asks about absence.
* `afterState` empty after `followupDeclined` is true: the caregiver chose not to say.
* `observedPeriod` is kept as said. "Today" and "this week" become approximate dates only in the profile, using the time the message arrived, and are marked approximate.

### Questionnaire answers

Connect does not store questionnaire answers yet. The profile has room for them now, in the shape the assessments section of the earlier Care requirements and the demo fixture already use. For the demo they come from the scenario fixture and are labeled synthetic.

Four instruments have room: AD8, FAQ, NPIQ, and ZBI22. Item wording is not stored in the profile or in this repository. Items are identified by the registry item ids.

One assessment record is one person answering one instrument on one date. It has:

* `record_type` of assessment, `instrument_code` (AD8, FAQ, NPIQ, or ZBI22), `instrument_version`, `instrument_language`, `administration_mode`, and `scoring_version`.
* `respondent_id` and the respondent's role. Each caregiver has their own record. Answers are never pooled.
* `assessment_date`, and `observed_period` for the recall period the instrument uses.
* `item_responses`, one per item, each with the item id, the original answer category, the answer value, and `answer_status`: valid, unknown, skipped, or not_asked.
* `completion_status`, either complete or incomplete, and `missing_item_ids`.
* `total_score` and `subscores`, empty unless the record is complete. A total from a source with no item details is labeled "Reported total; item details unavailable".
* `source`: live, imported, or synthetic, plus review status and license status.

By instrument:

* AD8: 8 items. Change, no change, and unknown are kept separate. Total 0 to 8 only when all 8 are valid. An informant is the preferred respondent.
* FAQ: 10 items. The six original answer categories stay distinct even when two share a score, including both never did categories. Total 0 to 30 only when all 10 are valid.
* NPIQ: 12 domains. Each is present yes, no, or unknown. If present, severity 1 to 3 and distress 0 to 5. The recall period is the previous month. Severity total 0 to 36 and distress total 0 to 60 only when all 12 are answered. A domain not asked is not_asked. It is not absent.
* ZBI22: 22 items, each answered from never to nearly always and scored 0 to 4. In this build only the first 12 items are asked, which are the first two item groups in the registry. Items 13 to 22 are recorded as not_asked, with the reason "not asked by design".

Rules for the partial ZBI22:

* Q1 The record is incomplete. It has no ZBI22 total and no subscore. Nothing is added up from the 12 answers.
* Q2 It is never called the 12 item short form. The published short form is a separate instrument, and the first 12 items of ZBI22 are not assumed to be that form. Confirm with the rights holder before any real use.
* Q3 It is never compared with a complete ZBI22 total. Two partial records from the same caregiver may be compared item by item, with both dates shown.
* Q4 Items 13 to 22 are not data gaps and are never chased with a question.
* Q5 Whether to show a labeled sum of the 12 answers is an open decision. Until it is decided, none is shown.

Questionnaire answers and live observations stay separate. A live observation never fills a questionnaire item, and a questionnaire answer never creates a live observation. They may sit side by side in the profile, each with its own label.

## 4. The profile

* PRO1 There is one profile per patient. Records have no patient field yet, so until they do, the profile is built per caregiver account and shows `attribution: unconfirmed` with the names the caregiver used ("Dad", "Mom"). It never merges two people silently.
* PRO2 Sections, in this order: safety events, data gaps, behavior, lucidity episodes, activities, context, formal assessments, reviews, return messages.
* PRO3 Each entry shows the value as reported, whether it is assigned or confirmed, the period as said, any approximate date marked approximate, the evidence (record ids, quotes, reported times), earlier values from revisions, and what is missing.
* PRO4 Behavior shows the latest value for each domain that was reported, with earlier values and times beneath. Domains not reported are listed as not reported. It may say how many of the 12 domains were reported, and never adds a total. It never multiplies or combines severity and distress.
* PRO5 Activities merge notes about the same activity into one entry that lists all the evidence. Enjoyment, ability, participation, and the reason given are separate lines. "Reason not known" is shown as said. Stopping an activity is never shown as decline.
* PRO6 Each lucidity episode shows its four details, with "not provided" where empty. It claims no meaning and no prediction.
* PRO7 Context lists dated excerpts for daily_function, caregiver_wellbeing, medical_context, and positive_moment. Caregiver wellbeing is context. It is not a burden score.
* PRO8 Formal assessments have their own section, with one entry for each questionnaire record described in section 3, for AD8, FAQ, NPIQ, and ZBI22. Each entry shows the instrument, respondent, date, source label (live, imported, or synthetic), completion, the answered items with their original answer categories, and a total only when the record is complete. Entries are never combined with live observations in any line or number.
* PRO9 Data gaps lists what is missing and what would fill it, for example "severity not reported for delusions", "number of nights not stated", "patient not confirmed". Each gap has a status: open, asked, declined, or filled. Items not asked by design, such as ZBI22 items 13 to 22, are listed as not asked and are not gaps.
* PRO10 Each profile is a snapshot with a generated time, a record count, and a version. It is marked stale when records change after it was made.
* PRO11 The compiler may group, restate, and cite. It may not add facts, fill empty values, assign scores, or infer cause. Summary lines use the caregiver's words. Any derived value, such as an approximate date, is marked derived.

Profile skeleton, placeholder values only:

```json
{
  "profile_id": "<pseudonymous id>",
  "schema_version": "<version>",
  "data_kind": "synthetic",
  "patient": {
    "patient_id": "<id or unconfirmed>",
    "names_used_by_caregiver": ["Dad"],
    "attribution": "unconfirmed"
  },
  "caregiver_links": [
    { "respondent_id": "<pseudonymous id>", "contact_route": "caregiver_account", "opted_out": false }
  ],
  "snapshot": { "generated_at": "<time>", "record_count": 0, "stale": false },
  "safety_events": [],
  "data_gaps": [],
  "behavior": [
    {
      "domain": "agitation_aggression",
      "label_status": "assigned",
      "severity": 2,
      "distress": 3,
      "period_as_said": "this evening at dinner",
      "evidence": [{ "record_id": "<id>", "quote": "<caregiver words>", "reported_at": "<time>" }],
      "earlier_values": [{ "field": "distress", "value": 4, "replaced_at": "<time>" }]
    }
  ],
  "lucidity_episodes": [],
  "activities": [],
  "context": { "daily_function": [], "caregiver_wellbeing": [], "medical_context": [], "positive_moments": [] },
  "formal_assessments": {
    "items": [
      {
        "record_id": "<id>",
        "instrument_code": "ZBI22",
        "respondent_id": "<pseudonymous id>",
        "source": "synthetic",
        "assessment_date": "<date>",
        "completion_status": "incomplete",
        "administration_scope": "items 1 to 12 of 22, by design",
        "item_responses": [
          { "item_id": "<registry item id>", "answer_code": "<original category>", "answer_value": 0, "answer_status": "valid" }
        ],
        "missing_item_ids": ["<registry ids for items 13 to 22>"],
        "missing_reason": "not asked by design",
        "total_score": null,
        "subscores": null
      }
    ]
  },
  "reviews": [],
  "return_messages": []
}
```

## 5. Reaching the profile

* ACC1 Clinicians reach the profile without needing Connect's chat history.
* ACC2 The view is read only: the JSON, and one text page generated from it. No chart is required. Values appear exactly as stored.
* ACC3 The text page follows the section order in PRO2, so safety is read first.
* ACC4 Access is by a simulated clinician role tied to the patient's care team. Each read is logged with who, when, and which snapshot. Roles are labeled simulated.
* ACC5 For the demo, storage is the local data file Connect already writes plus a profile file in the same ignored folder. Neither is committed. Phase 3 moves both to the database.

## 6. Safety intake

* SAF1 Rules and AI use one closed list of alert categories. The rules already use: stroke, breathing, unresponsive, chest_pain, seizure, serious_fall, missing, harm, overdose, fall, sudden_confusion, not_eating_drinking, fever, caregiver_crisis. The AI must choose from the same list.
* SAF2 Proposed additions, because the AI caught these with no matching category: injury, unusual_drowsiness, patient_self_harm, other_urgent.
* SAF3 Every alert keeps its level, source, category, matched words or AI reason, time received, the fixed text that was sent, and the delivery state. Today the sent text and delivery state are not stored.
* SAF4 Alerts about the same event join one safety event: same patient, related category, within a window the team sets. A worse report or a new category starts a new event.
* SAF5 Safety events appear first. Each shows whether a person was notified, exactly as the notification outcome says. If no care team phone is configured, it shows "No coverage configured".
* SAF6 Priority describes workflow attention, not medical risk. Nothing says someone is watching.
* SAF7 A message that triggered an alert is shown only under safety. It is not shown as a behavior observation unless the caregiver separately described a symptom.
* SAF8 A past event with no danger now is a safety observation for review, not an alert.
* SAF9 Emergency wording sent to the caregiver is fixed text. The compiler and the simulated clinician never write it.

## 7. Demo scenario and simulated feedback

The clinician's feedback in the demo is scripted. The team writes one scenario from start to finish. No live model plays the clinician.

* SIM1 There is one scenario fixture that covers the whole loop, in order: the starting records for a fake caregiver account, the expected profile snapshot, the scripted clinician feedback that cites entries in that snapshot, the return message text as approved, the caregiver's scripted reply, and the expected profile after the reply.
* SIM2 The scenario includes at least: one safety event, one open data gap that gets a clarification, one entry from each of the four questionnaires with ZBI22 limited to items 1 to 12, one return message, and one reply.
* SIM3 Feedback types are a clarification question, a check in reminder, or an acknowledgement with no message. A clarification comes from an open data gap in PRO9, one question per message.
* SIM4 Every profile entry the scripted feedback cites must exist in the scenario snapshot. A check compares the script against the compiled profile, so the script cannot drift from the data.
* SIM5 Every scripted message follows RET7.
* SIM6 The scripted feedback is stored with the snapshot id, the reviewer shown as "Simulated clinician", and the time. It is labeled simulated everywhere it appears.
* SIM7 A person running the demo approves each message. Nothing is sent from a draft.
* SIM8 If the demo shows report text drafted by AI, that text follows the Care AI reporting instructions: draft only, evidence cited, overlap and not cause, no diagnosis. It is separate from the scripted clinician feedback.
* SIM9 The scenario fixture uses a fake phone number. The same fixture tests the profile and the return message.

## 8. Return message

* RET1 A return message is a record with: `caregiver_message`, `review_status`, `reviewer_id`, `approved_actions`, `approved_at`, the profile entries and record ids that prompted it, `dispatch_id`, `sent_at`, `delivery_state`, and `in_reply_to` once answered.
* RET2 States: draft, approved, held, queued, sent, delivered, failed, replied, closed.
* RET3 Only approved text is sent, exactly as approved. Names and similar placeholders are filled by code from the profile. The model never rewrites approved text.
* RET4 The recipient is the caregiver account on the profile, the address the caregiver texts from, resolved at send time. The clinician view never shows or accepts a phone number. It uses the same Photon send path as other proactive texts.
* RET5 On a shared Photon line, the recipient must be a registered project user, or the send fails with "Target not allowed". That is shown as `failed` with the reason. It is never described as the caregiver refusing.
* RET6 Before sending, the system checks four things. The caregiver has not opted out. There is no open emergency event for the patient. The text is not a duplicate. The text meets RET7. If a check fails, the message is `held` with the reason visible. Care cannot override an opt out.
* RET7 Message rules: 30 words or fewer. Acknowledge first. One ask. Plain words. No scores, medical terms, diagnosis, or treatment. Always allow skip. Never promise that someone is watching.
* RET8 At most one return message per caregiver per day. Respect quiet hours when the caregiver has set them.
* RET9 Every sent message is added to the caregiver's conversation history as an assistant turn, so the AI agent sees what was asked. Today only the model's own replies are stored.
* RET10 The caregiver's reply is saved as a normal record linked by `in_reply_to`. A reply that answers a clarification updates the targeted record through the usual guard, using the caregiver's latest words. A reply that does not answer leaves the gap open. "Skip" marks that gap declined.
* RET11 A reply is not proof an action was done. No reply is not a finding. The gap stays open with "no reply" noted, and the message is not resent.

Examples, synthetic and fixed:

* Clarification: "Thanks for telling us about [name]'s evenings. About how many nights this week was he like that? A number is fine, or skip."
* Check in reminder: "Thank you for all you do. Would you like a short check in tomorrow evening? Reply YES, or skip."

## 9. Integration

Who does what:

* Connect records the categories, answers the caregiver, and delivers approved messages.
* Intelligence compiles records and questionnaire records into the profile.
* Care stores the profile and the scripted feedback, and owns approval.

Flow: records, then profile snapshot, then scripted clinician feedback, then a person approves, then return message through the caregiver account, then the caregiver's reply becomes a new record, then the profile rebuilds.

What Connect must add so the profile can meet the Care data contract:

* INT1 A confirmed patient id on every record.
* INT2 The Photon message id on every record and chat turn, so every profile entry traces to its source message.
* INT3 The time the message arrived as the reported time. Today it is the time the reply finished.
* INT4 An alert category from the SAF1 list and a level on every alert, including AI alerts.
* INT5 The fixed text sent and its delivery state on every alert.
* INT6 A store for return messages, with the fields in RET1.
* INT7 An outbound send helper that also records the sent text in the chat history.
* INT8 A way to load questionnaire records into the profile. For the demo, the scenario fixture is loaded directly, with no Connect change. When Connect later gives questionnaires by text, it stores assessment records in the shape in section 3.

Mapping to the earlier Care record envelope: `id` is `record_id`. `kind` is `record_type`. `caregiver` becomes a pseudonymous `respondent_id`. `reportedAt` is `recorded_at`. `observedPeriod` is `observed_period`. `source` is `source_type`. `revisions` become `version` and `supersedes_record_id`. Still missing: `patient_id`, `care_team_id`, `data_kind`, `source_record_ids`, `verification_status`, and `schema_version`.

## 10. Acceptance checks

Use a copy of the sample test conversation as the fixture, with a fake phone number.

1. The profile builds from the fixture. Rebuilding it gives the same result.
2. Agitation shows severity 2 and distress 3, with distress 4 listed as an earlier value and its time.
3. Delusions shows severity and distress as not reported. No domain is shown as absent.
4. "She wants to end it all" appears under safety only. It does not appear under behavior as depression.
5. The two chess notes appear as one activity with both pieces of evidence and "reason not known". Gardening shows current enjoyment and ability not reported.
6. The lucidity episode shows duration, context, and what was said. The after state shows "not provided".
7. All six alerts appear, labeled rules or ai. The two self harm alerts 20 seconds apart appear as one safety event.
8. Every profile entry opens to its quote, record id, and reported time.
9. No section contains a stage or risk level. Totals appear only on complete questionnaire records, labeled with their source. No phone number appears anywhere.
10. The four questionnaires appear in the formal assessments section, each labeled synthetic, with the respondent and the original answer categories.
11. The ZBI22 entry shows 12 of 22 items asked, items 13 to 22 as not asked by design, completion incomplete, and no total or subscore of any kind. It is not called a short form and is not compared with a complete ZBI22 total.
12. The FAQ entry keeps both never did categories distinct. The AD8 entry keeps unknown separate from no change.
13. A live observation never appears as a questionnaire answer, and no questionnaire answer appears as a live observation.
14. Every profile entry the scripted feedback cites exists in the scenario snapshot, and every scripted message is 30 words or fewer.
15. A draft that is not approved sends nothing.
16. An approved message goes to the caregiver account on the profile, and is stored with a dispatch id and delivery state.
17. An opted out caregiver's message is `held` with the reason shown.
18. A reply of "3" after a clarification updates the right record, and links to the return message.
19. A send to a user not registered on a shared line shows `failed`, not "refused".

## 11. Open decisions

* How patient is confirmed: ask the caregiver once, or take it from enrollment.
* The window for grouping alerts into one safety event.
* Whether to adopt the four levels in the Emergencies file in code, or keep emergency and urgent.
* The proposed alert category additions in SAF2.
* Who writes the scenario script, and who approves the messages during the demo.
* Whether to show a labeled sum of the ZBI22 items 1 to 12 (Q5).
* The existing fixture has only complete ZBI22 records. The scenario needs a 12 item record added.
* Whether Connect later asks the full NPIQ as a questionnaire, or keeps only live observations.
* Where the profile lives after the demo: file or database.
* Quiet hours defaults, and how many days with no reply before the gap is noted.
