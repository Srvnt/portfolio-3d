import raw from './content.json';

interface Link { label: string; url: string }

export interface SkillNode {
  name: string;
  icon?: string;
  note?: string;
  children?: SkillNode[];
}

export interface Content {
  profile: { name: string; role: string; tagline: string; location: string };
  about: { title: string; paragraphs: string[] };
  projects: { title: string; year: string; role: string; summary: string; tags: string[]; links: Link[] }[];
  skills: SkillNode[];
  experience: { period: string; title: string; company: string; summary: string }[];
  contact: { intro: string; links: Link[] };
  guide: { name: string; lines: string[] };
  secrets: string[];
  fish: { name: string; fact: string }[];
  warning: string[];
  weather: { place: string; lat: number; lon: number };
}

export const content: Content = raw;
