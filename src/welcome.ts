// First-time welcome: two fixed, warm messages the first time a caregiver
// texts Lucidity (fixed wording, so it's consistent and instant).

export const WELCOME_MESSAGES = [
  "Hi, I'm Lucidity 💙 I'm here to help you keep track of how your loved one is doing, so the little things don't get lost between doctor visits.",
  "Just text me in your own words, anytime: a rough night, a good moment, something that's worrying you. I'll save it for the care team, help with reminders, and if anything sounds urgent, I'll tell you right away what to do. Text STOP anytime to pause. Who are you caring for?",
];

/** A first message that's only a greeting gets just the welcome (no AI reply). */
export function isGreetingOnly(text: string): boolean {
  return /^(hi|hii+|hello|hey|heya|hiya|yo|start|hi there|hello there|hey there|good (?:morning|afternoon|evening)|test(?:ing)?)[\s!.,?👋🙂😊]*$/i.test(
    text.trim(),
  );
}
