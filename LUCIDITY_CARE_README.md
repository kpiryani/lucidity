# Lucidity Care Requirements Package

Version 1.2, October 10, 2026. Lucidity Care. Synthetic demo only.

Lucidity Care is the physician and care team component. For the hackathon it is three things: a profile built from what Connect records, scripted clinician feedback for the demo, and a return message to the caregiver through their account. The full dashboard, with patient overview, charts, and review queue, is planned for after the hackathon.

Connect supplies caregiver data and delivers approved caregiver messages. Intelligence compiles the profile and prepares draft reports for review in Care.

## Which file wins

For the hackathon, the profile requirements file decides what to build. Where it differs from the Care requirements file on the dashboard, the charts, or the review queue, follow the profile file. The Care requirements file still applies for the incoming data contract (the shared record envelope, evidence, and assessments), notifications, and approval rules.

## Files in this package

* `LUCIDITY_CARE_PROFILE_REQUIREMENTS.md`: what to build for the hackathon. It has the category dictionary from what Connect stores today, the profile for each patient, room for AD8, FAQ, NPIQ, and ZBI22 answers (ZBI22 items 1 to 12 only), safety intake, the scripted demo scenario, the return message to the caregiver's account, the items Connect must add, acceptance checks, and open decisions.
* `LUCIDITY_CARE_REQUIREMENTS.md`: Care's full requirements. These are the incoming data contract, the doctor layout, charts, notifications, clinical review, and follow up tracking. The layout and chart parts are deferred. The rest still applies.
* `LUCIDITY_CARE_AI_REPORTING_INSTRUCTIONS.md`: what Intelligence receives and how it prepares evidence linked reports for clinician review. It applies to any AI drafted report text the demo shows.
* `LUCIDITY_CARE_DEMO_DATA.json`: one fictional patient with evidence, complete and incomplete assessments, chart ready measures, a draft report, notification examples, and follow up events. Use it as the shape reference for questionnaire records and as a base for the scenario fixture. It has complete ZBI22 records only, so the scenario needs a 12 item record added.
* This README: the package index, the precedence rule, and compatibility notes.

## Related files outside this package

* `LUCIDITY_CONNECT_EMERGENCIES.md`: the emergency levels, fixed texts, and rules that the profile's safety intake builds on.
* The Connect free response addendum: the rules for turning free text into records. Keep it.
* The Connect requirements files: what Connect collects and how it asks. See the note under Original requirements.

## How to use

1. Read the profile requirements first.
2. Use the Care requirements for the data contract and the approval rules.
3. Use the AI reporting instructions if the demo shows AI drafted report text.
4. Build the scenario fixture described in section 7 of the profile requirements, using the JSON as a shape reference. Test the profile and the return message with it.

Add these five files to the repository. This package contains requirements and synthetic examples, not an implemented dashboard or deployed service. It has not been pushed to GitHub by this chat.

In every fixture, all identities, messages, scores, approvals, and delivery outcomes are synthetic. Use fake phone numbers, and never commit real ones. Example priorities are demonstration workflow priorities, not medically validated triage thresholds. Care team rules must define real clinical thresholds and coverage separately. A follow up in the demo is a clarification request, not a treatment recommendation. No Photon credentials or real contact details are included.

## Original requirements

The earlier free response addendum is now on the requirements branch. The original `LUCIDITY_CONNECT.md` and `LUCIDITY_CONNECT_BASELINE_CHECKINS.md` were absent from the branch snapshot checked on October 10, 2026. They remain available in the earlier [requirements commit](https://github.com/kpiryani/lucidity/tree/c31cd8783f08fb0a31e5c58ca432333233d5be77). This package does not delete, overwrite, or restore those files.
