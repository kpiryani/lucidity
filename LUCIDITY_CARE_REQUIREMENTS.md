# Lucidity Care — Physician Dashboard and Clinical Review Requirements

**Version:** 1.1 · October 10, 2026 · Synthetic hackathon MVP  
**Component:** Lucidity Care — the physician and care-team interface.  
**Purpose:** Define the data Care receives from Connect and simulated Intelligence, the patient overview and charts Care displays, its notifications, and the clinical review and follow-up controls doctors use to make their own assessments. This specifies Lucidity Care; it does not implement the dashboard.

**Companions:** [Care AI reporting instructions](LUCIDITY_CARE_AI_REPORTING_INSTRUCTIONS.md) and [Care synthetic demonstration data](LUCIDITY_CARE_DEMO_DATA.json). The Connect free-response addendum defines upstream caregiver intake; this document defines Care's receiving and review requirements.

## 1. Product outcome

A doctor should quickly understand what changed, what remains stable, how the caregiver is doing, which scores are available, how complete the information is, and what needs review. Every finding must open its supporting records. The doctor can form and document an independent assessment, request clarification, and approve, revise, or reject proposed follow-ups.

**Flow:** caregiver message → Lucidity Connect collection and confirmation → structured records and valid scores → Lucidity Intelligence draft → Lucidity Care dashboard and doctor review → approved follow-up through Connect/Photon → caregiver response and outcome tracked in Care.

Connect owns caregiver collection, attribution, and deterministic assessment scoring. Intelligence organizes and summarizes supplied evidence for Care. Care validates incoming records and owns the physician dashboard, deterministic comparisons/chart series, configured notification rules, clinician notes, approvals, and care-team action tracking. Clinicians own clinical decisions. Connect/Photon delivers Care-approved messages and returns caregiver responses to Care.

**P0:** must work in the demonstration. **P1:** next improvement. Use fictional identities and synthetic records throughout; no live clinical coverage is implied.

## 2. Data Lucidity Care receives

Care accepts a patient-scoped evidence bundle from Connect and draft reports from Intelligence. The requirements below define Care's incoming data contract and display behavior. Unsupported, mismatched, or incomplete data must have an explicit validation or missing-information state.

### DATA-01 — Shared record envelope · P0

Every record has `record_id`, `record_type`, `schema_version`, `patient_id`, `respondent_id` when applicable, `care_team_id`, `data_kind`, `source_type`, `source_record_ids`, `recorded_at`, `observed_period`, `verification_status`, `version`, and `supersedes_record_id` if corrected. Keep event time distinct from receipt time. Preserve approximate dates as approximate; unknown dates stay unknown. Store timezone and an ISO timestamp with offset or UTC.

Keep these states separate: caregiver confirmation, assessment completeness, provenance verification, clinician review, and action approval. A caregiver-confirmed report is still a caregiver report, not a clinician-verified finding.

### DATA-02 — Patient and caregiver context · P0

Include patient display name, age if known, living situation, current care-team assignment, baseline references, preferred activities, reported constraints, and authorized caregiver links. Diagnosis, medications, and other clinical context must carry their source and verification state; unknown values stay unknown. Multiple caregiver accounts must remain distinct, with relationship and observation coverage. Show ZBI and symptom-related distress as belonging to a named respondent.

### DATA-03 — Original evidence and observations · P0

Preserve original message text and message ID, channel, sender, reported/received timestamps, reply context, and consent/access reference. Observations include topic, patient/caregiver subject, descriptive text, exact supporting quote, source-message IDs, reporting period, direct/secondhand/interpretation classification, change from baseline, confirmation IDs, and unresolved questions.

Separate candidate extraction from confirmed observations. Keep negation, uncertainty, reported reasons, and conflicting accounts. “He stopped gardening because his knee hurt” is a reported activity change with a reported physical explanation; it is not proof of cognitive decline. An unconfirmed extraction cannot quietly become a confirmed chart value.

### DATA-04 — Assessments · P0

Send instrument code/version/language, administration mode, scoring version, respondent, assessment date and recall period, item IDs and original answer categories, completeness/missing items, subscores, provenance, and review state. Preserve imported totals separately from totals computed from item responses. Scores that cannot be recomputed are visibly labeled “Reported total; item details unavailable.”

Required score panels, each on its own scale:

- **AD8:** 0–8; cognitive/functional change screening, not a diagnosis or dementia stage. [Developer guidance](https://knightadrc.wustl.edu/professionals-clinicians/ad8-instrument/).
- **FAQ:** 0–30; reported functional ability. Preserve the distinct never-performed categories. [Instrument handout](https://alz.org/media/documents/functional-activities-questionnaire.pdf).
- **NPI-Q symptom severity:** 0–36, with a separate **caregiver distress** panel at 0–60. Use the registered monthly recall period. [Original validation study](https://psychiatryonline.org/doi/10.1176/jnp.12.2.233).
- **ZBI-22:** 0–88, separately for each caregiver. [University-hosted instrument and scoring reference](https://wai.wisc.edu/wp-content/uploads/sites/1129/2021/11/Zarit-Caregiver-Burden-Assessment-Instruments.pdf).

The instrument definitions, permissions, and administration requirements remain in the registry. Synthetic fixtures demonstrate data handling, not validated conversational administration. Never produce a total from incomplete responses or add these scales into an overall patient score.

### DATA-05 — Activities and measurable observations · P0

Each activity record retains activity ID/name, date/period, attempted status, participation, enjoyment, ability/assistance, reason reported, evidence, and confirmation. These are independent dimensions. “Not attempted,” “no longer enjoys,” “needs help,” “never did,” and “unknown” have different meanings.

Numeric measures require value, unit, numerator/denominator where relevant, period, collection method, and confirmation. “Woke on five of seven nights” supports `5/7 nights`; “up all the time” supports a qualitative report and a clarification request, not seven nights or a severity rating. Uncertain numeric estimates remain labeled estimates.

### DATA-06 — Reviews, actions, and communication · P0

Actions include proposal/version, supporting records, intended recipient, owner, due time, status, reviewer ID/time, exact approved message, dispatch ID, delivery state, caregiver response, and outcome evidence. Record clinician notes separately from AI drafts. A response being received does not prove an action was performed; action completion does not prove clinical improvement.

## 3. The doctor's information layout

### VIEW-01 — Patient list and review queue · P0

Each row shows patient identity, primary respondent, last observation date, pending reviews/actions, incomplete-data indicator, and rule-based notifications. Sort by review priority and due time. “No recent information” is a data state, not “stable.” Do not rank patients using an invented AI risk score.

### VIEW-02 — Patient overview · P0

At the top: patient identity, selected date range/respondent, source freshness, and synthetic-data label. Present a compact overview with:

1. **Changes reported:** dated findings and source links.
2. **Abilities and routines maintained:** supported positive/stable observations, including patient preferences.
3. **Assessment snapshot:** five separate score values with dates, completeness, provenance, and review state.
4. **Caregiver situation:** burden/distress, reported sleep/support, and respondent identity.
5. **Needs review / missing information:** explicit questions and reasons, followed by outstanding actions.

Default to the last 30 days of observations and up to 90 days of assessment history; offer 7/30/90-day and custom filters. Show the older comparison date when a latest assessment is outside the selected observation window. A latest score must show its actual date rather than implying it describes today.

The “overall assessment” is a dated narrative across cognition, function, behavior/sleep, activity/preferences, caregiver burden, and data completeness. Give every domain an evidence-supported description or “insufficient information.” Do not substitute a composite number, stage, or automatic diagnosis. The doctor's assessment is separately authored and attributed.

### VIEW-03 — Evidence and history · P0

Click any finding, score, chart point, or notification to see its source text/form, respondent, period, confirmation, missing information, and revision history. Offer timeline, assessments, activities, and actions sections. For an external total, the evidence drawer states whether item-level responses exist. Show discrepant caregiver reports side by side, without averaging them away.

### VIEW-04 — Review controls · P0

Doctors can approve, revise, reject, or request clarification on a report/proposed follow-up. Record a reason for revision or rejection. Keep report approval and action/message approval separate. Editing a message creates a new version that must be explicitly approved. Clinical notes may be saved independently of approving an AI report.

Use patient-scoped role checks: authorized clinician/reviewer, assigned care-team coordinator, and caregiver with their own authorized view. Enforce access on the server, including evidence retrieval and exports. A coordinator cannot approve clinical recommendations unless their role explicitly authorizes it. Display demo roles as simulated.

## 4. Charts: what qualitative data can show

All charts name the metric, axes and units, time range, source/respondent, and completeness. Labels and symbols must carry meaning without relying on color. Every point links to evidence. Do not infer values from silence, interpolate through missing records, combine incompatible scales, or smooth sparse data into a predicted course.

### CHART-01 — Assessment history · P0

Use separate small charts for AD8, FAQ, NPI-Q severity, NPI-Q distress, and each caregiver's ZBI. X axis: assessment date; Y axis: instrument points with its defined range. Plot complete results; annotate an incomplete assessment at its date without a numeric total. Use a distinct marker for reported imports without item details.

Compare only the same instrument/version/subscore, compatible administration modes, and compatible reference periods. Keep respondent changes visible; the default series stays within one respondent. Display absolute point change and the two dates. If only one valid point exists, show that point and no trend claim. Changes are numeric differences, not proven clinical deterioration or treatment response.

### CHART-02 — Behavioral domain detail · P0

For a selected NPI-Q, compare domain ratings with a prior compatible assessment. Use separate severity and distress panels; each domain is one labeled row. Missing domains remain visually distinct from confirmed absence. Never multiply by frequency or create a combined severity/distress index.

### CHART-03 — Activity timeline · P0

Use categorical rows by activity and observation date. Show participation, enjoyment, and assistance separately, with labels such as “played with help,” “not attempted,” and “unknown.” Display reported reasons in the detail view. Do not encode a new cognitive score from these categories or treat an unattempted activity as inability.

### CHART-04 — Confirmed frequency · P0

Plot a confirmed measure such as affected nights divided by nights observed. X axis: the reported period; Y axis: affected nights, with denominator shown on each point. A `5/7` record and `1/1` record are different observation coverage, not directly comparable seven-day totals. Unknown weeks create gaps. Do not allocate a weekly retrospective count to invented daily dates or sum overlapping windows.

### CHART-05 — Qualitative evidence timeline · P0

Show dated source excerpts grouped by topic: cognition, function, behavior, activities, caregiver wellness, support, and safety. Distinguish newly reported change, maintained ability, uncertainty, and clinician note. If P1 adds a topic-count chart, its unit is **reports**, not symptom episodes or severity; use unique current observation records, with collection-volume context.

### CHART-06 — Engagement and outcomes · P1

Chart eligible invitations and received responses separately from patient measures. Respect opt-out/pause periods. Show approved actions and reported outcomes as timeline annotations. An outcome after an action is temporally subsequent; it does not establish that the action caused the outcome.

## 5. Notifications and review priorities

**NOTIFY-01 · P0:** Notifications are produced by versioned rules, not freely chosen AI urgency. Each includes patient, category, priority, rule/version, trigger records, time, owner, due time if configured, explanation, and status. Priority describes workflow attention, not a validated medical-risk prediction.

Required categories:

- **Reported safety concern:** use the existing care-team-approved safety rules and predefined caregiver guidance. Present matched evidence; route according to configured coverage. A queued alert never promises that a clinician is watching continuously.
- **New confirmed change needing review:** a new function/behavior observation or changed complete score can enter the review queue under a configured rule. Numeric clinical thresholds require clinician-approved configuration and supporting rationale; the demo can flag any changed score as a workflow event without calling it clinically significant.
- **Caregiver asks for help:** route an explicit support request to an assigned reviewer, preserving their words.
- **Missing or conflicting information:** create a data-quality task when it blocks scoring or interpretation. No reply is an operational follow-up condition, not evidence of worsening.
- **Draft ready:** add a report to the review queue; group routine events rather than sending a notification for every message.
- **Approved action overdue or delivery failed:** notify the action owner with due/dispatch evidence. Failed delivery does not mean caregiver refusal.

**NOTIFY-02 · P0:** Deduplicate by patient + rule + source event/version. Group repeated routine findings into an update to the same open notification. A new safety event or materially changed evidence must still be evaluated. Keep the count of unreviewed events visible. Corrections can supersede a notification and must retain its history.

**NOTIFY-03 · P0:** Track `new → acknowledged → assigned → resolved/dismissed/superseded`, with owner, reason, and time. Acknowledgment does not close the clinical concern or complete an action. Routine reminders honor quiet hours, consent, pause, and STOP. Care-team coverage, response targets, escalation destinations, and any safety override must be explicitly configured; do not invent them in AI output.

External notices should contain a minimal patient reference and secure-view link, with detailed evidence inside the authorized view. The synthetic demo may use simulated delivery states.

## 6. Approval and caregiver follow-up

**ACTION-01 · P0:** `proposed → approved/rejected`; a revision creates a new proposal. Approved actions can progress through `queued → sent → response_received → followup_pending → closed`, or show delivery failure, decline, no response, or need for help. Keep these as explicit events rather than assuming one universal successful path.

**ACTION-02 · P0:** Before dispatch, verify current patient/recipient permission, consent, reviewer role, exact approved message version, and current source/report versions. Use a dispatch idempotency key. A report approval alone does not authorize sending all associated recommendations.

**ACTION-03 · P0:** A correction supersedes dependent drafts/approvals and holds unsent messages for renewed review. Preserve delivered-message history and surface a review task if a correction affects already communicated advice. Concurrent review saves must reject stale versions.

**ACTION-04 · P0:** Save the caregiver's reply with receipt time, reported completion, barriers, and outcome period. Show “caregiver reports completed” separately from clinician-verified outcome. Reported improvement requires evidence and remains distinct from an attribution of cause.

Predetermined consent, clarification, and safety templates are separate from AI-proposed clinical recommendations and follow their existing approved workflows.

## 7. End-to-end acceptance and demo

The included synthetic fixture supplies two complete assessment timepoints, an incomplete NPI-Q, four weekly nighttime observations including one unknown week, activity records, an evidence-linked report, and an approved follow-up with a caregiver reply.

Acceptance checks:

1. A doctor sees the latest complete scores with their dates and named respondent; incomplete October 10 NPI-Q does not replace the October 1 complete result.
2. Charts show NPI-Q severity **9 → 14**, distress **16 → 24**, FAQ **12 → 18**, ZBI **31 → 49**, and AD8 **3 → 3**, as synthetic descriptive results rather than diagnoses.
3. Nighttime counts **2/7 → unknown → 5/7 → 3/7** retain the gap and do not imply continuous worsening.
4. An activity not attempted for lack of opportunity does not become declining ability. Gardening assistance attributed by the caregiver to a sore knee does not become an AI claim of cognitive decline.
5. Clicking every generated claim/point reveals valid evidence IDs, respondent, period, and current revision. Exact quotes match their source.
6. Missing, negative, zero, skipped, and unasked states remain distinct; an incomplete form has no final total.
7. A second caregiver or changed instrument version breaks automatic comparability; no blended ZBI or distress series is produced.
8. Notifications state their rule and supporting facts, deduplicate routine events, and distinguish review work from medical urgency.
9. Only an authorized reviewer can approve an exact follow-up; stale approval or revoked recipient permission prevents dispatch.
10. Revision/rejection, request for clarification, failed delivery, no response, and caregiver-reported completion all have visible states and audit history.
11. The doctor's independently written assessment is stored separately from the AI draft. Hypotheses remain hypotheses after display.
12. The demo completes assessment → evidence-linked draft → simulated doctor decision → approved Photon message → caregiver response → tracked outcome.

**First implementation slice:** one Care patient overview, five score panels, one activity timeline, one nighttime-frequency chart, evidence drawer, review queue, and one follow-up approval flow. The three-person team can own Care data integration, Intelligence/validation, and Care dashboard/review respectively. Keep AI simulated until the contract and review flow work.

## 8. Compatibility and source notes

The current branch contains [the free-response addendum](https://github.com/kpiryani/lucidity/blob/lucidity-req/LUCIDITY_CONNECT_FREE_RESPONSE_ADDENDUM.md). The original two Connect documents are absent from the branch snapshot checked on October 10; their previously inspected versions remain available at [Connect requirements](https://github.com/kpiryani/lucidity/blob/c31cd8783f08fb0a31e5c58ca432333233d5be77/LUCIDITY_CONNECT.md) and [Baseline/check-ins](https://github.com/kpiryani/lucidity/blob/c31cd8783f08fb0a31e5c58ca432333233d5be77/LUCIDITY_CONNECT_BASELINE_CHECKINS.md). This package adds new files only and makes no repository changes.

Clinical ranges above are sourced; layout, notification defaults, report structure, and workflow rules are proposed Lucidity product requirements, not clinically validated alert policies. Full copyrighted questionnaires are not reproduced here.
