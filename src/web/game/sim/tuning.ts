/** Every timing that shapes office life, in seconds unless the name says otherwise. */
export const TUNING = {
  walkSpeed: 2.4,
  hurrySpeed: 4.2,
  doorFade: 0.4,
  /** After finishing, an agent waits at the desk with a raised hand this long… */
  waitAtDeskMs: 40_000,
  /** …then takes a break in the lounge, and after this long dozes off back at the desk. */
  dozeAfterMs: 8 * 60_000,
  /** A command running longer than this is a good excuse for a coffee. */
  longCommandMs: 25_000,
  /** A delegator walks over to check on a helper after this long. */
  checkInAfterMs: 20_000,
  checkInEvery: 35,
  minGoalHold: 5,
  build: 2.8,
  closeAfterEmpty: 45,
  shrinkAfter: 90,
  evacuateTimeout: 14,
  bubbleTtl: 4.6,
  coffeeFor: 4,
  hangoutMin: 18,
  hangoutMax: 40,
  chatGapMin: 8,
  chatGapMax: 16,
  replyDelay: 1.7,
  loungeChatGap: 3.5,
  brainEvery: 0.25,
  maxLog: 40,
} as const;
