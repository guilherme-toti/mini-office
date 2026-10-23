import { createRandom, hashString, pick } from '../../../shared/random.ts';

export type Gender = 'female' | 'male' | 'nonbinary';

export type HairStyle =
  'short' | 'spiky' | 'buzz' | 'long' | 'bob' | 'bun' | 'ponytail' | 'curly' | 'bald';

export type Outfit = 'tee' | 'stripes' | 'collar' | 'hoodie' | 'dress';
export type Accessory = 'none' | 'glasses' | 'headphones';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  bottom: string;
  shoes: string;
  outfit: Outfit;
  accessory: Accessory;
}

export interface Persona {
  name: string;
  gender: Gender;
  look: Look;
}

const NAMES: Record<Gender, readonly string[]> = {
  female: [
    'Ana',
    'Bia',
    'Carla',
    'Daniela',
    'Elena',
    'Fernanda',
    'Gabi',
    'Helena',
    'Isabela',
    'Julia',
    'Karen',
    'Larissa',
    'Marina',
    'Nina',
    'Olivia',
    'Paula',
    'Rafaela',
    'Sofia',
    'Tania',
    'Vera',
    'Yasmin',
    'Zoe',
    'Amara',
    'Chloe',
    'Freya',
    'Hana',
    'Ingrid',
    'Leah',
    'Mei',
    'Priya',
  ],
  male: [
    'André',
    'Bruno',
    'Caio',
    'Diego',
    'Eduardo',
    'Felipe',
    'Gustavo',
    'Hugo',
    'Igor',
    'João',
    'Kevin',
    'Lucas',
    'Mateus',
    'Nico',
    'Otávio',
    'Pedro',
    'Rafael',
    'Samuel',
    'Thiago',
    'Victor',
    'Yuri',
    'Arjun',
    'Ben',
    'Daniel',
    'Ethan',
    'Hiro',
    'Kofi',
    'Leo',
    'Omar',
    'Tom',
  ],
  nonbinary: [
    'Alex',
    'Ariel',
    'Blake',
    'Charlie',
    'Dani',
    'Eden',
    'Jamie',
    'Jordan',
    'Kai',
    'Morgan',
    'Noa',
    'Quinn',
    'Remy',
    'River',
    'Robin',
    'Sam',
    'Sky',
    'Taylor',
  ],
};

const SKINS = ['#ffdbc2', '#f5c6a5', '#e8b08a', '#c98e65', '#a46a45', '#7a4a2c'];
const HAIR_COLORS = [
  '#2b1d16',
  '#4a2e1f',
  '#7b4a26',
  '#b8742f',
  '#e3bf6a',
  '#1c1c24',
  '#9c3b2e',
  '#c7c3cf',
  '#5a3d8a',
  '#2f6e8a',
];
const TOPS = [
  '#e45b5b',
  '#f0a63c',
  '#f2d44a',
  '#7ccf6b',
  '#3fb6a8',
  '#4c8fe0',
  '#7a6cf0',
  '#c868d8',
  '#ef7fae',
  '#f5f1e8',
  '#3b4256',
  '#8a5a3c',
];
const BOTTOMS = ['#2d3a5c', '#3b3b46', '#5b4636', '#6c7a8a', '#2f4f3a', '#1f2430'];
const SHOES = ['#2a2a30', '#f0f0f0', '#7b4a26', '#c0392b'];

const HAIR_BY_GENDER: Record<Gender, readonly HairStyle[]> = {
  female: ['long', 'bob', 'bun', 'ponytail', 'curly', 'long'],
  male: ['short', 'spiky', 'buzz', 'curly', 'short', 'bald'],
  nonbinary: ['short', 'bob', 'curly', 'spiky', 'bun', 'buzz'],
};

const OUTFITS_BY_GENDER: Record<Gender, readonly Outfit[]> = {
  female: ['tee', 'stripes', 'collar', 'hoodie', 'dress', 'dress'],
  male: ['tee', 'stripes', 'collar', 'hoodie', 'tee'],
  nonbinary: ['tee', 'stripes', 'hoodie', 'collar'],
};

/** Every agent gets a stable person: the same id always walks in as the same character. */
export function createPersona(agentId: string): Persona {
  const random = createRandom(hashString(agentId));
  const roll = random();
  const gender: Gender = roll < 0.46 ? 'female' : roll < 0.92 ? 'male' : 'nonbinary';
  const accessoryRoll = random();
  return {
    name: pick(random, NAMES[gender]),
    gender,
    look: {
      skin: pick(random, SKINS),
      hair: pick(random, HAIR_COLORS),
      hairStyle: pick(random, HAIR_BY_GENDER[gender]),
      top: pick(random, TOPS),
      bottom: pick(random, BOTTOMS),
      shoes: pick(random, SHOES),
      outfit: pick(random, OUTFITS_BY_GENDER[gender]),
      accessory: accessoryRoll < 0.22 ? 'glasses' : accessoryRoll < 0.34 ? 'headphones' : 'none',
    },
  };
}

const INITIALS = 'ABCDEFGHJKLMNOPRSTVW';

/**
 * Two people with the same first name get a last initial, the way real teams tell them apart.
 */
export function distinctName(
  persona: Persona,
  agentId: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(persona.name)) return persona.name;
  const random = createRandom(hashString(`${agentId}:surname`));
  for (let attempt = 0; attempt < INITIALS.length; attempt += 1) {
    const candidate = `${persona.name} ${pick(random, INITIALS.split(''))}.`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${persona.name} ${agentId.slice(0, 3)}`;
}

export function lookKey(look: Look): string {
  return [
    look.skin,
    look.hair,
    look.hairStyle,
    look.top,
    look.bottom,
    look.shoes,
    look.outfit,
    look.accessory,
  ].join('|');
}
