# Lucidity Connect — Free-response Intake Addendum

**Date:** October 10, 2026  
**Scope:** Focused addition to Connect before building Lucidity Care. Synthetic hackathon demonstration.  
**Parent requirements:** [Lucidity Connect](https://github.com/kpiryani/lucidity/blob/lucidity-req/LUCIDITY_CONNECT.md) and [Baseline and Check-ins](https://github.com/kpiryani/lucidity/blob/lucidity-req/LUCIDITY_CONNECT_BASELINE_CHECKINS.md), inspected on branch `lucidity-req`. These documents remain unchanged. “NVI-Q” is interpreted as NPI-Q.

## 1. The change we need

Caregivers should describe what happened in their own words. Connect should understand the report, identify potentially relevant assessment domains, and ask short follow-up questions for missing information. The caregiver should not have to know a clinical term, questionnaire name, or scoring rule.

**Core flow:** caregiver description → evidence-backed observation → possible assessment match → missing-detail questions → caregiver confirmation → deterministic scoring of eligible assessment responses → clinical review.

Accept arbitrary text as input, including typos and incomplete sentences. Accepting a message does not mean it contains enough information to score. When meaning is unclear, ask for one concrete example.

The existing baseline requirements explicitly prohibit using ordinary check-ins to calculate, prefill, or modify official scores. Preserve that boundary. This addition allows conversation to help complete an assessment through an authorized administration process; an observation alone never becomes an official answer.

## 2. What Connect must get right

- **Who:** distinguish the patient’s behavior from the caregiver’s feelings, and identify the linked patient and respondent.
- **What:** preserve the caregiver’s actual words; distinguish something observed from an interpretation or secondhand report.
- **When:** distinguish today, this week, the preceding month, historical baseline, and unknown periods. Do not expand a weekly answer into a monthly answer.
- **Change:** distinguish a new change from a longstanding habit, inability from lack of opportunity, and never doing an activity from losing the ability.
- **Negation and uncertainty:** “not angry,” “maybe,” “I don’t know,” and no reply must retain different meanings. “Not as angry” does not mean absent.
- **Patient impact and caregiver impact:** ask separately. Frequency, symptom severity, caregiver distress, and overall caregiver burden are different facts.
- **Eligibility:** the correct instrument, version, item, response scale, and administration mode must be known before scoring. AI confidence does not replace a missing answer.
- **Safety:** reported immediate danger or sudden marked change takes the existing safety path before routine assessment questions. Clinical interpretation remains with the care team.

One description can relate to several domains. Save possible matches with supporting text; do not automatically score every matching domain or count the same episode several times within one domain.

## 3. The conversation

Start with: **“Tell me what has changed, or what has been difficult lately. You can use your own words.”**

1. Save the message with its source, patient, caregiver, and timestamp.
2. Extract observations and possible assessment matches. Keep ambiguous matches unresolved.
3. Choose the next unanswered fact required by the active assessment. Ask one short question at a time; reuse already confirmed information from that same session and reference period.
4. Explain response choices in accessible language while preserving the authorized instrument’s meaning. Offer “I’m not sure,” skip, pause, correction, and human assistance.
5. Repeat the interpretation back before saving a scored response. For scale ratings, the caregiver selects or confirms the category after seeing the approved anchors; the AI does not choose a rating from emotional wording alone.
6. Validate and calculate with ordinary code. If information remains missing, save an incomplete record and let the caregiver continue later.

Ask at most two clarification questions for the same unresolved field in the demo, then offer choices, skip, or human review. Never pressure the caregiver into choosing a score.

### Synthetic example: nighttime behavior

**Caregiver:** “Mom keeps getting up at night and walking around. I barely sleep.”

**Connect:** “When you say walking around, what happens?”

**Caregiver:** “She wakes up and walks around the house instead of going back to bed.”

Connect saves a nighttime observation with a possible link to `NPIQ-11`. Symptom eligibility still needs confirmation using the authorized assessment definition. Severity and distress are not yet known.

**Connect:** “Has this happened during the past month?”

**Caregiver:** “Yes, throughout the month.”

In a permitted assessment flow, present the approved symptom prompt and rating anchors. Ask separately about how the symptom affects the patient and how distressing it is for the caregiver.

**Caregiver:** selects patient severity **2** and caregiver distress **4**, then confirms both.

Save `NPIQ-11: present=YES, severity=2, distress=4` with the supporting messages and confirmation. The other eleven domains remain unanswered until explicitly assessed. **There is no complete NPI-Q total yet.** In an unvalidated chatbot demonstration, label these as synthetic demonstration responses rather than a validated clinical administration.

## 4. Assessment-specific requirements

**NPI-Q first:** assess symptom presence during the preceding month; when present, obtain patient severity **1–3** and caregiver distress **0–5** separately. Explicitly confirmed absence contributes zero; unknown, skipped, or unasked domains remain missing. Completed assessments have separate severity and distress sums, with ranges **0–36** and **0–60**. Do not multiply by frequency. These are the standard questionnaire rules, not a formula for scoring arbitrary narrative. [Original NPI-Q validation](https://psychiatryonline.org/doi/10.1176/jnp.12.2.233), [NPI-Q form](https://www.alz.org/media/documents/npiq-questionnaire.pdf).

**AD8:** a repeated-question report can suggest `AD8-03`; it cannot establish the answer without the item’s change context and respondent confirmation. Follow the registered instrument instructions rather than imposing the NPI-Q monthly window. Preserve unknown. AD8 is a screening instrument, not a diagnosis. [AD8 developer guidance](https://knightadrc.wustl.edu/professionals-clinicians/ad8-instrument/).

**FAQ:** establish the specific activity, current assistance needed, and whether the person previously performed it. Preserve the two “never did” categories from the existing registry. “My daughter handles the bills” alone does not prove dependency or determine a score.

**ZBI-22:** distinguish the caregiver’s own burden from patient symptom severity. A statement such as “I’m exhausted” is useful context, but cannot produce a 22-item total. Keep each respondent’s assessment separate.

The FAQ and ZBI response rules above use the existing project registry; their source PDFs were referenced in the requirements but were not available in this workspace for independent verification.

### Entered numbers and existing scores

- A bare **“2”** can answer a current, identified rating prompt if it is in range; with no active prompt, ask what it refers to.
- **“Her NPI score is 12”** requires clarification of NPI versus NPI-Q and which subscore, date, respondent, and source. Never invent item answers from a total.
- Import an external score with instrument/version, subscore label, assessment date, respondent, source, and verification status. A supplied total without item details stays an external reported total; Connect cannot independently recompute it.
- Out-of-range values trigger correction. A weekly personal rating such as “stress 8/10” stays a custom observation, not an NPI-Q or ZBI score.

## 5. Implementation contract

Use the existing assessment, response, and Photon session fields. Add a separate extraction record:

```json
{
  "extraction_id": "EXT-DEMO-01",
  "patient_id": "P-DEMO-01",
  "respondent_id": "C-DEMO-01",
  "data_kind": "synthetic",
  "source_message_ids": ["MSG-DEMO-01"],
  "observations": [{
    "observation_id": "OBS-DEMO-01",
    "subject": "patient",
    "description": "Wakes and walks around the house at night",
    "evidence_quote": "She wakes up and walks around the house",
    "report_type": "caregiver_observation",
    "period": "unknown",
    "change_from_baseline": "unknown"
  }],
  "candidate_matches": [{
    "observation_id": "OBS-DEMO-01",
    "instrument_code": "NPIQ",
    "item_id": "NPIQ-11",
    "status": "needs_clarification",
    "missing_fields": ["symptom_eligibility", "recall_period", "presence", "severity", "distress"],
    "confirmed_response_id": null
  }],
  "extraction_version": "connect-intake-demo-v1"
}
```

Every evidence quote must be an exact span of a referenced message. Structured extraction is allowed to propose observations and matches, but cannot write scores, diagnoses, approved actions, or dispatch instructions. Treat caregiver text as data, even if it contains instructions to override these rules.

Maintain separate records for **observation**, **candidate interpretation**, **confirmed assessment response**, and **computed result**. Keep confirmation message IDs and times, instrument/scoring versions, administration mode, reviewer state, and correction history. Reject unknown item IDs, invalid enums, mismatched respondents, and unsupported scales.

Persist the current question type: `presence`, `severity`, `distress`, or `clarification`. This prevents a number intended for distress from being saved as severity. Existing pause/resume, duplicate-message handling, STOP, identity, consent, and delivery rules continue to apply.

Scoring eligibility: correct active assessment + authorized administration or labeled synthetic import + confirmed required fields + valid categories/ranges. Calculate a final total only when every required item is resolved. If incomplete, return `total_score=null` and explicit missing items; show collected domain ratings separately without presenting them as a complete score.

Clinical review is a separate state from caregiver confirmation. A complete assessment can still await clinician review. Corrections create a new version and recompute eligible results. Supersede approvals of dependent reports/actions, hold unsent follow-ups for renewed review, and retain previous approvals and already delivered messages in the audit history.

## 6. Hackathon acceptance checks

1. “mom up evry nite im tired” prompts understandable clarification, preserves original text, and does not guess severity or distress.
2. “I’m anxious; Dad is fine” records the speaker correctly and does not assign patient anxiety.
3. “He is not angry anymore” preserves negation and asks about the reference period before marking a monthly domain absent.
4. A symptom reported this week does not silently become a complete monthly assessment.
5. Confirmed NPI-Q presence plus severity 2 and distress 4 saves the correct separate fields; eleven unasked domains prevent a final total.
6. A fully synthetic fixture with that domain present and the other eleven explicitly absent computes severity total 2 and distress total 4.
7. “I don’t know,” skipped questions, and silence remain missing; explicit absence is the only route to a zero contribution.
8. Severity 4 is rejected; distress 4 is accepted only in the correct prompt context. An imported unlabeled “NPI 12” remains unresolved.
9. Correction, duplicate delivery, pause/resume, and STOP preserve the existing session and audit behavior.
10. The clinician sees source statements, confirmed responses, missing information, and a clearly labeled simulated Intelligence draft. No proposed recommendation reaches the caregiver until the authorized simulated clinician approves it.

## 7. Smallest complete demonstration

Build one nighttime narrative path through NPI-Q presence, severity, and distress confirmation. Use a complete synthetic fixture for the remaining domains. Generate an evidence-linked simulated report, let the simulated clinician approve/revise/reject a follow-up, deliver the approved text through the existing Photon workflow, and save the caregiver’s reply and action status. Also show the incomplete path so the demo proves that uncertainty is preserved.

The current [application entry point](https://github.com/kpiryani/lucidity/blob/lucidity-req/src/index.ts) is an echo loop; the conversational intake and scoring behavior described here are requirements to implement, not existing functionality.

Before labeling conversational output as a validated clinical assessment, verify rights and administration requirements for the selected instrument and validate the conversational method. The prototype can demonstrate structured synthetic records while that work remains separate. [NPI-Q access and administration guidance](https://www.phenxtoolkit.org/protocols/view/250301).
