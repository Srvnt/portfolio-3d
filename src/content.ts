import raw from './content.json';

interface Link { label: string; url: string }

export interface SkillNode {
  name: string;
  /** short text or emoji shown in the gem; defaults to the first letters */
  icon?: string;
  /** optional tooltip text */
  note?: string;
  children?: SkillNode[];
}

export interface Content {
  profile: { name: string; role: string; tagline: string; location: string };
  about: { title: string; paragraphs: string[] };
  projects: { title: string; year: string; role: string; summary: string; tags: string[]; links: Link[] }[];
  /** Skill tree: main skills on top; children are skills they unlocked. */
  skills: SkillNode[];
  experience: { period: string; title: string; company: string; summary: string }[];
  contact: { intro: string; links: Link[] };
  sign: string[];
  secrets: string[];
  /** Each fish in the river reveals one fact. Order matches the species (pike, perch, trout, salmon). */
  fish: { name: string; fact: string }[];
  /** Text on the warning signs at the edge of the village. */
  warning: string[];
  /** Default place for live weather (visitors can change it in the weather menu). */
  weather: { place: string; lat: number; lon: number };
}

/** All portfolio text lives in content.json — edit that file, not the code. */
export const content: Content = raw;
