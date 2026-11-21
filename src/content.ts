import raw from './content.json';

interface Link { label: string; url: string }

export interface Content {
  profile: { name: string; role: string; tagline: string; location: string };
  about: { title: string; paragraphs: string[] };
  projects: { title: string; year: string; role: string; summary: string; tags: string[]; links: Link[] }[];
  skills: { name: string; level: number; category: string }[];
  experience: { period: string; title: string; company: string; summary: string }[];
  contact: { intro: string; links: Link[] };
  sign: string[];
  secrets: string[];
  /** Each fish in the river reveals one fact. Order matches the species (pike, perch, trout, salmon). */
  fish: { name: string; fact: string }[];
  /** Text on the warning signs at the edge of the village. */
  warning: string[];
}

/** All portfolio text lives in content.json — edit that file, not the code. */
export const content: Content = raw;
