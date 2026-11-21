import { describe, expect, it } from 'vitest';
import { renderSection } from './ui';
import { content, SkillNode } from '../content';

const allSkills = (list: SkillNode[]): SkillNode[] => list.flatMap((n) => [n, ...allSkills(n.children ?? [])]);

describe('panels', () => {
  it('renders every skill of the tree as an unlocked gem', () => {
    const html = renderSection('skills', content);
    const skills = allSkills(content.skills);
    expect(html.match(/class="st-gem"/g)).toHaveLength(skills.length);
    for (const s of skills) expect(html).toContain(`<span class="st-name">${s.name}</span>`);
    expect(html).toContain(`${skills.length} skills unlocked`);
  });

  it('nests unlocked skills under their parent', () => {
    const html = renderSection('skills', content);
    const java = html.indexOf('>Java<');
    const spring = html.indexOf('>Spring Boot<');
    const js = html.indexOf('>JavaScript<');
    expect(java).toBeGreaterThan(-1);
    expect(spring).toBeGreaterThan(java);
    expect(spring).toBeLessThan(js);
  });

  it('escapes text from content', () => {
    const evil = { ...content, skills: [{ name: '<img src=x onerror=alert(1)>' }] };
    const html = renderSection('skills', evil);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('opens external links safely', () => {
    const html = renderSection('contact', content);
    for (const l of content.contact.links) expect(html).toContain(l.label);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it('renders every section without throwing', () => {
    for (const id of ['about', 'projects', 'skills', 'experience', 'contact'] as const)
      expect(renderSection(id, content)).toContain('id="panel-title"');
  });
});
