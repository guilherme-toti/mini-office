export const en = {
  app: {
    title: 'Mini Office',
    tagline: 'Your AI team, at work',
  },
  connection: {
    live: 'Live',
    connecting: 'Connecting…',
    offline: 'Offline — retrying',
  },
  source: {
    demo: 'Demo office',
    switchToDemo: 'Try the demo',
    switchToLive: 'Back to my agents',
  },
  summary: {
    people: '{count} at work',
    needYou: '{count} need you',
    needYouOne: '1 needs you',
  },
  activity: {
    thinking: 'Thinking',
    editing: 'Editing',
    reading: 'Reading',
    running: 'Running a command',
    browsing: 'Looking things up',
    delegating: 'Handing off work',
    planning: 'Planning',
    waiting: 'Waiting for you',
  },
  whereabouts: {
    desk: 'At the desk',
    lounge: 'In the lounge',
    walking: 'Walking around',
    away: 'In the hallway',
    dozing: 'Dozing off',
  },
  panel: {
    team: 'Team',
    empty: 'No agents are running right now.',
    emptyHint: 'Start Claude Code in any project and someone walks in.',
    lounge: 'Lounge',
    helperOf: 'Helping {name}',
    session: 'Claude Code session',
    since: 'for {time}',
    show: 'Show team',
    hide: 'Hide team',
    close: 'Close',
  },
  card: {
    task: 'Working on',
    room: 'Room',
  },
  controls: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    names: 'Names',
  },
  log: {
    joined: '{name} joined {room}',
    left: '{name} went home',
    growing: '{room} is getting more desks',
    shrinking: '{room} is getting cozier',
    opened: '{room} opened',
    closed: '{room} closed for the day',
  },
  room: {
    renovating: 'Renovating',
    people: '{count}',
  },
  time: {
    seconds: '{n}s',
    minutes: '{n}m',
    hours: '{n}h',
  },
  say: {
    greet: [
      'Hi everyone! I’m {name}.',
      'Morning, team!',
      'Reporting for duty.',
      'Hey! Where do I sit?',
    ],
    brief: ['{child}, can you take this? “{task}”', '{child}, I need a hand: {task}'],
    briefNoTask: ['{child}, can you help me with something?'],
    accept: ['On it!', 'Leave it to me.', 'Sure thing.'],
    report: ['Done: {task}', 'All finished!', 'Here you go, all done.'],
    thanks: ['Thanks, {child}!', 'Great work, {child}.', 'Perfect, thank you!'],
    leave: ['See you later!', 'Signing off.', 'Bye, team!'],
    yourTurn: ['Done! Your turn.', 'Ready when you are.', 'Need your input here.'],
    breakStart: ['Coffee time.', 'Stretching my legs.', 'Quick break.'],
    backToWork: ['Oh! New task.', 'Back to it!', 'Coming, coming!'],
    longCommand: [
      'That will take a while. Coffee!',
      'Tests are running, grabbing a coffee.',
      'Build is cooking.',
    ],
    evacuate: ['They’re expanding {room}!', 'Everybody out, new desks!', 'Renovation time.'],
    renovationTalk: [
      'Can’t wait to see the new desks.',
      'More room for plants!',
      'I hope they keep my chair.',
    ],
    returning: ['Ooh, new desks.', 'Look at all this space!', 'Home sweet home.'],
    checkIn: ['How’s it going, {child}?', 'Need anything, {child}?'],
    checkInReply: ['Almost there!', 'Getting close.', 'Just a moment more.'],
    smallTalk: [
      'How’s {room} going?',
      'Did you see the new coffee machine?',
      'Waiting on feedback, as usual.',
      'I’ve been in {detail} all morning.',
      'Anyone else hungry?',
      'Who left the build running?',
    ],
    smallTalkReply: [
      'Busy, but good.',
      'Same here.',
      'Classic.',
      'Ha, tell me about it.',
      'Best thing in this office.',
      'Can’t complain.',
    ],
  },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : { readonly [K in keyof T]: Widen<T[K]> };

/** Every locale has exactly these keys; the compiler keeps them in sync. */
export type Messages = Widen<typeof en>;
