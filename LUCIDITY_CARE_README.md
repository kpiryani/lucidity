# Lucidity Care — Requirements Package

**Version 1.1 · October 10, 2026 · Lucidity Care · Synthetic demo only**

Lucidity Care is the physician and care-team component: patient overview, assessment history, charts, evidence-linked reports, notifications, clinical review, and follow-up tracking. Connect supplies caregiver data and delivers approved caregiver messages. Intelligence prepares draft reports for review in Care.

## Files

- `LUCIDITY_CARE_REQUIREMENTS.md`: Care's incoming data contract, physician overview, scores, qualitative/activity charts, notifications, clinical review, and follow-up tracking.
- `LUCIDITY_CARE_AI_REPORTING_INSTRUCTIONS.md`: What Intelligence receives and how it prepares evidence-linked reports for clinician review in Care.
- `LUCIDITY_CARE_DEMO_DATA.json`: One fictional Care patient view with evidence, complete and incomplete assessments, chart-ready measures, draft report, notification examples, and follow-up events.
- This README: upload/use instructions and compatibility notes.

## Upload and use

Extract the ZIP and add these four new files to the repository. Keep the existing free-response addendum. This package contains requirements and synthetic examples, not an implemented dashboard or deployed service. It has not been pushed to GitHub by this chat.

Read the Care requirements first, use the AI reporting instructions when implementing simulated Intelligence, and use the JSON fixture to build and verify the first Care dashboard screen. Example priorities are demonstration workflow priorities, not medically validated triage thresholds. Care-team rules must define real clinical thresholds and coverage separately.

In the fixture, all identities, messages, scores, approvals, and delivery outcomes are synthetic. The follow-up is a clarification request, not a treatment recommendation. No Photon credentials or real contact details are included.

## Original requirements

The earlier free-response addendum is now present on `lucidity-req`. The original `LUCIDITY_CONNECT.md` and `LUCIDITY_CONNECT_BASELINE_CHECKINS.md` are absent from the current branch snapshot checked on October 10, 2026. They remain available in the earlier [requirements commit](https://github.com/kpiryani/lucidity/tree/c31cd8783f08fb0a31e5c58ca432333233d5be77). This package does not delete, overwrite, or restore those files.
