import { test } from "node:test";
import assert from "node:assert/strict";
import { WELCOME_MESSAGES, isGreetingOnly } from "./welcome.ts";

test("greetings get only the welcome; real reports continue to the AI", () => {
  for (const t of ["hi", "Hello!", "hey there 👋", "start", "good morning", "test"]) assert.ok(isGreetingOnly(t), t);
  for (const t of ["hi, dad was up all night", "my mom keeps forgetting my name", "help"]) assert.ok(!isGreetingOnly(t), t);
});

test("welcome is two short, warm messages that mention STOP and ask who they care for", () => {
  assert.equal(WELCOME_MESSAGES.length, 2);
  assert.match(WELCOME_MESSAGES[0]!, /^Hi, I'm Lucidity/);
  assert.match(WELCOME_MESSAGES[1]!, /STOP/);
  assert.match(WELCOME_MESSAGES[1]!, /Who are you caring for\?$/);
});
