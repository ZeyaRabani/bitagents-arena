import { createHash } from "crypto";

export interface GeneratedAgent {
  name: string;
  ability: string;
  flavor: string;
  attack: number;
  defense: number;
  speed: number;
}

const KEYWORDS: Record<"attack" | "defense" | "speed", string[]> = {
  attack: [
    "fire", "dragon", "attack", "burn", "sword", "blade", "rage", "smash", "war",
    "hunter", "claw", "fang", "storm", "thunder", "explosive", "berserk", "venom",
  ],
  defense: [
    "shield", "tank", "armor", "wall", "rock", "stone", "guard", "turtle", "iron",
    "steel", "fortress", "hedgehog", "shell", "sturdy", "brick", "titan",
  ],
  speed: [
    "fast", "quick", "swift", "ninja", "flash", "wind", "sonic", "rabbit", "cheetah",
    "caffeinated", "bolt", "dash", "zoom", "lightning", "hyper", "rocket",
  ],
};

const ABILITY_BANK = [
  "Overclock", "Last Stand", "Static Surge", "Adrenaline Rush", "Counterstrike",
  "Berserker Mode", "Iron Will", "Phantom Step", "Chain Lightning", "Second Wind",
  "Critical Focus", "Momentum Shift", "Unyielding", "Ambush Protocol", "Hyperdrive",
];

const NAME_PREFIXES = ["Nad", "Blitz", "Volt", "Kyro", "Zex", "Rune", "Byte", "Fang", "Orb", "Grit"];
const NAME_SUFFIXES = ["ix", "on", "ar", "us", "ox", "yn", "el", "or", "ax", "iq"];

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function byteAt(hash: Buffer, i: number): number {
  return hash[i % hash.length];
}

/** Deterministic: same prompt always yields the same agent, no external calls. */
export function generateAgentFromPrompt(prompt: string): GeneratedAgent {
  const clean = prompt.trim().toLowerCase();
  const hash = sha256(clean || "blank agent");

  let attack = 15 + (byteAt(hash, 0) % 25); // 15-39 base
  let defense = 15 + (byteAt(hash, 1) % 25);
  let speed = 15 + (byteAt(hash, 2) % 25);

  for (const word of KEYWORDS.attack) if (clean.includes(word)) attack += 12;
  for (const word of KEYWORDS.defense) if (clean.includes(word)) defense += 12;
  for (const word of KEYWORDS.speed) if (clean.includes(word)) speed += 12;

  attack = Math.min(attack, 99);
  defense = Math.min(defense, 99);
  speed = Math.min(speed, 99);

  const ability = ABILITY_BANK[byteAt(hash, 3) % ABILITY_BANK.length];

  const prefix = NAME_PREFIXES[byteAt(hash, 4) % NAME_PREFIXES.length];
  const suffix = NAME_SUFFIXES[byteAt(hash, 5) % NAME_SUFFIXES.length];
  const promptWords = prompt.trim().split(/\s+/).filter(Boolean);
  const firstWord = promptWords[0]?.replace(/[^a-zA-Z]/g, "");
  const name =
    firstWord && firstWord.length > 2
      ? `${firstWord[0].toUpperCase()}${firstWord.slice(1, 6)}${suffix}`
      : `${prefix}${suffix}`;

  const dominant =
    attack >= defense && attack >= speed ? "attack" : defense >= speed ? "defense" : "speed";
  const flavorByDominant: Record<string, string> = {
    attack: "hits first and hits hard.",
    defense: "shrugs off everything you throw at it.",
    speed: "is already gone before you land a move.",
  };

  const flavor = `"${prompt.trim() || "A mysterious agent"}" — ${flavorByDominant[dominant]}`;

  return { name, ability, flavor, attack, defense, speed };
}
