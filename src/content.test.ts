import { describe, expect, it } from 'vitest';
import { content, SkillNode } from './content';
import { WorldMap } from './world/map';

const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

describe('content.json', () => {
  it('has a profile and a player title', () => {
    expect(nonEmpty(content.profile.name)).toBe(true);
    expect(nonEmpty(content.profile.role)).toBe(true);
    expect(nonEmpty(content.player)).toBe(true);
  });

  it('gives the elder something to say', () => {
    expect(nonEmpty(content.guide.name)).toBe(true);
    expect(content.guide.lines.length).toBeGreaterThan(0);
    content.guide.lines.forEach((l) => expect(nonEmpty(l)).toBe(true));
  });

  it('has a fact for each fish species', () => {
    expect(content.fish.length).toBeGreaterThanOrEqual(4);
    content.fish.forEach((f) => {
      expect(nonEmpty(f.name)).toBe(true);
      expect(nonEmpty(f.fact)).toBe(true);
    });
  });

  it('has a secret for every treasure chest', () => {
    const chests = new WorldMap().interactables.filter((it) => it.kind === 'chest').length;
    expect(content.secrets.length).toBeGreaterThanOrEqual(chests);
  });

  it('has a valid default weather place', () => {
    expect(nonEmpty(content.weather.place)).toBe(true);
    expect(Math.abs(content.weather.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(content.weather.lon)).toBeLessThanOrEqual(180);
  });

  it('has a well-formed skill tree', () => {
    const check = (n: SkillNode) => {
      expect(nonEmpty(n.name)).toBe(true);
      (n.children ?? []).forEach(check);
    };
    expect(content.skills.length).toBeGreaterThan(0);
    content.skills.forEach(check);
  });

  it('has links with real URLs', () => {
    const links = [...content.contact.links, ...content.projects.flatMap((p) => p.links)];
    links.forEach((l) => expect(l.url).toMatch(/^(https?:\/\/|mailto:)/));
  });
});
