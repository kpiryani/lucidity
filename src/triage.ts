// Rule-based safety triage. Runs on every inbound message *before* any LLM,
// so an urgent signal is never missed because a model misread it.
//
// Rules are tuned for recall over precision: missing an urgent message is the
// worst failure, so a false alarm ("he didn't fall") is an acceptable cost.
// The LLM layer added later can only escalate further, never downgrade.

export type TriageLevel = "emergency" | "urgent";

export type TriageCategory =
  | "stroke"
  | "breathing"
  | "unresponsive"
  | "chest_pain"
  | "seizure"
  | "serious_fall"
  | "missing"
  | "harm"
  | "overdose"
  | "fall"
  | "sudden_confusion"
  | "not_eating_drinking"
  | "fever"
  | "caregiver_crisis";

export interface TriageMatch {
  category: TriageCategory;
  level: TriageLevel;
  matched: string;
}

export interface TriageResult {
  level: TriageLevel;
  matches: TriageMatch[];
}

interface Rule {
  category: TriageCategory;
  level: TriageLevel;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  // Emergency: tell the caregiver to call 911 now.
  {
    category: "stroke",
    level: "emergency",
    patterns: [
      /\bstroke\b/,
      /\b(face|mouth|smile) (is )?(droop|drooping|crooked|uneven)/,
      /\bdroop(ing|y)?\b/,
      /\bslurr(ed|ing)\b/,
      /\b(can'?t|cannot|unable to) (move|lift|feel) (his|her|their|one|my) (arm|leg|side)/,
      /\b(one side|arm|leg) (is |went |gone )?(numb|weak|limp)\b/,
    ],
  },
  {
    category: "breathing",
    level: "emergency",
    patterns: [
      /\b(not|isn'?t|stopped) breathing\b/,
      /\b(can'?t|cannot|trouble|struggling to|hard to) (catch (his|her|their) )?breath(e|ing)?\b/,
      /\bchok(e|ed|ing)\b/,
      /\bturning (blue|purple)\b/,
    ],
  },
  {
    category: "unresponsive",
    level: "emergency",
    patterns: [
      /\bunresponsive\b/,
      /\bunconscious\b/,
      /\b(won'?t|will not|can'?t|cannot) (wake|be woken|rouse)\b/,
      /\bpassed out\b/,
      /\b(fainted|collapsed|blacked out)\b/,
      /\bnot responding\b/,
    ],
  },
  {
    category: "chest_pain",
    level: "emergency",
    patterns: [/\bchest (pain|pressure|tightness|hurts)\b/, /\bheart attack\b/],
  },
  {
    category: "seizure",
    level: "emergency",
    patterns: [/\bseizure/, /\bconvuls/],
  },
  {
    category: "serious_fall",
    level: "emergency",
    patterns: [
      /\b(fell|fall|fallen|tripped)\b(?! asleep).*\b(hit|bumped|banged) (his|her|their) head\b/,
      /\b(hit|bumped|banged) (his|her|their) head\b/,
      /\b(fell|fall|fallen)\b(?! asleep).*\b(bleeding|blood|broke|broken|can'?t get up|cannot get up|won'?t get up)\b/,
      /\b(can'?t|cannot) get (him|her|them) up\b/,
    ],
  },
  {
    category: "missing",
    level: "emergency",
    patterns: [
      /\b(is|went|has gone|have gone|been|gone|now) missing\b/,
      /\b(can'?t|cannot) find (him|her|them|mom|dad|my (mom|dad|mother|father|husband|wife|grandma|grandpa))\b/,
      /\bwander(ed)? off\b/,
      /\b(left|walked out of) the house\b.*\b(don'?t|do not) know where\b/,
      /\b(don'?t|do not) know where (he|she|they) (is|are|went)\b/,
    ],
  },
  {
    category: "harm",
    level: "emergency",
    patterns: [
      /\bsuicid/,
      /\bkill (my|him|her|them)sel(f|ves)\b/,
      /\b(want|wants|wanting) to die\b/,
      /\bend (my|his|her|their) life\b/,
      /\b(threaten(ed|ing)?|tried) to (hurt|hit|kill|attack)\b/,
      /\b(hurt|hit|attack(ed)?|punch(ed)?|chok(ed|ing)) (me|someone|somebody|the aide|my (son|daughter|wife|husband))\b/,
      /\b(grabbed|holding|has|had|waving|pointing|picked up|threaten\w*)\b.*\b(a|the|my|his|her) (gun|knife|weapon)\b/,
    ],
  },
  {
    category: "overdose",
    level: "emergency",
    patterns: [
      /\boverdos/,
      /\b(took|swallowed|taken) (too many|all (of )?(his|her|their|the)) (pills|meds|medication|tablets)\b/,
      /\b(took|takes|taken) (his|her|their) (pills|meds|medication) twice\b/,
    ],
  },

  // Urgent: contact the doctor today; the care team should see it promptly.
  {
    category: "fall",
    level: "urgent",
    patterns: [/\b(fell|fallen|falling)\b(?! asleep)/, /\b(tripped|slipped)\b/, /\bhad a fall\b/],
  },
  {
    category: "sudden_confusion",
    level: "urgent",
    patterns: [
      /\b(suddenly|all of a sudden|out of nowhere|overnight)\b.*\b(confused|disoriented|delirious|not making sense)\b/,
      /\b(confused|disoriented|not making sense)\b.*\b(suddenly|all of a sudden|out of nowhere)\b/,
      /\bmuch (more|worse) confused\b/,
      /\b(delirium|delirious)\b/,
    ],
  },
  {
    category: "not_eating_drinking",
    level: "urgent",
    patterns: [
      /\b(hasn'?t|has not|won'?t|will not|refuses to|refusing to|not) (been )?(eat|eaten|eating|drink|drunk|drinking)\b/,
      /\bdehydrat/,
    ],
  },
  {
    category: "fever",
    level: "urgent",
    patterns: [/\bfever\b/, /\b(high|running a) temp(erature)?\b/, /\b10[1-5](\.\d)? ?(°|degrees|f)\b/],
  },
  {
    category: "caregiver_crisis",
    level: "urgent",
    patterns: [
      /\b(i )?(can'?t|cannot) do this anymore\b/,
      /\b(i'?m|i am) (at|at the end of) my (limit|rope)\b/,
      /\b(i'?m|i am) breaking down\b/,
      /\b(i'?m|i am) going to hurt\b/,
    ],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the most severe triage result, or `null` if no rule fires. */
export function triage(text: string): TriageResult | null {
  const normalized = normalize(text);
  const matches: TriageMatch[] = [];

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const hit = normalized.match(pattern);
      if (hit) {
        matches.push({ category: rule.category, level: rule.level, matched: hit[0] });
        break;
      }
    }
  }

  if (matches.length === 0) return null;
  const level = matches.some((m) => m.level === "emergency") ? "emergency" : "urgent";
  return { level, matches };
}

const has = (result: TriageResult, category: TriageCategory) =>
  result.matches.some((m) => m.category === category);

/** Plain-language reply sent to the caregiver for a triaged message. */
export function triageReply(result: TriageResult): string {
  const lines: string[] = [];

  if (result.level === "emergency") {
    lines.push("This sounds like it could be an emergency. Please call 911 now.");
    if (has(result, "missing")) {
      lines.push("Tell them a person with dementia is missing, and share a recent photo and what they were wearing.");
    }
    if (has(result, "stroke")) {
      lines.push("Note the time symptoms started; that matters for stroke treatment.");
    }
    if (has(result, "harm")) {
      lines.push("If you or anyone is in danger, move to a safe place first. You can also call or text 988 (Suicide & Crisis Lifeline).");
    }
    if (has(result, "overdose")) {
      lines.push("You can also call Poison Control at 1-800-222-1222. Keep the pill bottles with you.");
    }
  } else {
    lines.push("Thank you for telling me. This is something to raise with your doctor today; please call their office.");
    if (has(result, "fall")) {
      lines.push("After a fall, watch for new pain, confusion, or trouble walking. If any appear, call 911.");
    }
    if (has(result, "sudden_confusion")) {
      lines.push("Sudden changes in confusion can be a sign of infection or another medical problem. If you also see face drooping, arm weakness, or slurred speech, call 911.");
    }
    if (has(result, "caregiver_crisis")) {
      lines.push("You're carrying a lot. If you ever feel you might hurt yourself or someone else, call or text 988. The Alzheimer's Association 24/7 Helpline is 1-800-272-3900.");
    }
    lines.push("If things get worse at any point, call 911.");
  }

  return lines.join("\n\n");
}

/**
 * Fixed reply when the AI (not the keyword rules) flags something as urgent.
 * Emergency wording is never generated by the model.
 */
export const AI_ESCALATION_REPLY = [
  "What you're describing may need medical attention soon.",
  "If anyone is in danger, or things are getting worse, call 911 now. Otherwise, please call the doctor's office today.",
  "If you or anyone might be harmed, you can also call or text 988.",
].join("\n\n");

/** Fixed, supportive line sent after AI_ESCALATION_REPLY instead of model text. */
export const AI_ESCALATION_FOLLOWUP = "I'm here with you. When things are calmer, you can tell me how it went.";
