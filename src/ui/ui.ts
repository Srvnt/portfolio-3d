import * as THREE from 'three';
import type { Interactable, SectionId } from '../world/map';
import type { Content, SkillNode } from '../content';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function links(list: { label: string; url: string }[]) {
  if (!list.length) return '';
  return `<div class="links">${list
    .map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`)
    .join('')}</div>`;
}

function renderSection(id: SectionId, c: Content): string {
  switch (id) {
    case 'about':
      return `<h2 id="panel-title">${esc(c.about.title)}</h2>
        <p class="meta">${esc(c.profile.name)} · ${esc(c.profile.role)} · ${esc(c.profile.location)}</p>
        ${c.about.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`;
    case 'projects':
      return `<h2 id="panel-title">Quest Board</h2><p class="meta">Completed quests — selected projects</p>
        <div class="quests">${c.projects
          .map((p) => `<article class="quest">
            <h3>${esc(p.title)}</h3>
            <p class="meta">${esc(p.year)} · ${esc(p.role)}</p>
            <p>${esc(p.summary)}</p>
            <ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            ${links(p.links)}
          </article>`)
          .join('')}</div>`;
    case 'skills': {
      // RPG skill tree: main skills across the top, the skills they unlocked branching below.
      // Nodes light up one after another (staggered animation delay).
      let order = 0;
      const node = (n: SkillNode, major: boolean): string => {
        const icon = n.icon ?? n.name.slice(0, 2);
        const delay = `style="--d:${(order++ * 0.09).toFixed(2)}s"`;
        const kids = n.children?.length
          ? `<span class="st-stem" ${delay}></span><div class="st-kids">${n.children.map((k) => node(k, false)).join('')}</div>`
          : '';
        return `<div class="st-node${major ? ' major' : ''}"${n.note ? ` title="${esc(n.note)}"` : ''}>
            <span class="st-gem" ${delay}><span>${esc(icon)}</span><i class="st-check" aria-hidden="true">✓</i></span>
            <span class="st-name">${esc(n.name)}</span>
            ${kids}
          </div>`;
      };
      const total = (list: SkillNode[]): number => list.reduce((a, n) => a + 1 + total(n.children ?? []), 0);
      return `<h2 id="panel-title">Smithy</h2>
        <p class="meta">Skill tree · ${total(c.skills)} of ${total(c.skills)} skills unlocked</p>
        <div class="skill-tree" role="list">${c.skills.map((n) => `<div class="st-branch" role="listitem">${node(n, true)}</div>`).join('')}</div>`;
    }
    case 'experience':
      return `<h2 id="panel-title">Library</h2><p class="meta">Chronicles — work experience</p>
        <ol class="timeline">${c.experience
          .map((e) => `<li><p class="meta">${esc(e.period)}</p><h3>${esc(e.title)} · ${esc(e.company)}</h3><p>${esc(e.summary)}</p></li>`)
          .join('')}</ol>`;
    case 'contact':
      return `<h2 id="panel-title">Post Office</h2><p>${esc(c.contact.intro)}</p>${links(c.contact.links)}`;
  }
}

export class UI {
  private dialogEl = $('#dialog');
  private dialogName = this.dialogEl.querySelector('.name') as HTMLElement;
  private dialogText = this.dialogEl.querySelector('.text') as HTMLElement;
  private dialogMore = this.dialogEl.querySelector('.more') as HTMLElement;
  private panelWrap = $('#panel-wrap');
  private panelContent = $('#panel .content');
  private labels = new Map<string, HTMLElement>();
  private lines: string[] = [];
  private line = 0;
  private shown = 0;
  private onDialogDone: (() => void) | null = null;
  onPanelClose: (() => void) | null = null;
  private lastFocus: Element | null = null;

  constructor(private content: Content) {
    $('#title .title-name').textContent = content.profile.name;
    // "Main role | specialty" → main role on one line, specialty smaller below
    const [main, ...rest] = content.profile.role.split('|').map((s) => s.trim());
    $('#title .title-role').innerHTML = esc(main) + (rest.length ? `<span class="title-sub">${esc(rest.join(' · '))}</span>` : '');
    document.title = `${content.profile.name} — Portfolio`;
    $('#panel .close').addEventListener('click', () => this.closePanel());
    this.panelWrap.addEventListener('click', (e) => { if (e.target === this.panelWrap) this.closePanel(); });
  }

  // ---------------------------------------------------------- title
  waitForStart(): Promise<void> {
    const el = $('#title');
    return new Promise((resolve) => {
      const go = () => {
        window.removeEventListener('keydown', go);
        el.removeEventListener('pointerdown', go);
        el.classList.add('gone');
        setTimeout(() => el.remove(), 700);
        resolve();
      };
      window.addEventListener('keydown', go);
      el.addEventListener('pointerdown', go);
    });
  }

  // ---------------------------------------------------------- dialog
  get dialogOpen() { return !this.dialogEl.hidden; }

  dialog(name: string, lines: string[], done: () => void) {
    this.lines = lines;
    this.line = 0;
    this.shown = 0;
    this.onDialogDone = done;
    this.dialogName.textContent = name;
    this.dialogEl.hidden = false;
    this.renderLine();
  }

  /** Finish the current line, or go to the next one. */
  advance() {
    const full = this.lines[this.line];
    if (this.shown < full.length) { this.shown = full.length; this.renderLine(); return; }
    this.line++;
    this.shown = 0;
    if (this.line >= this.lines.length) { this.closeDialog(); return; }
    this.renderLine();
  }

  closeDialog() {
    this.dialogEl.hidden = true;
    const cb = this.onDialogDone;
    this.onDialogDone = null;
    cb?.();
  }

  updateDialog(dt: number) {
    if (!this.dialogOpen) return;
    const full = this.lines[this.line];
    if (this.shown < full.length) {
      this.shown = Math.min(full.length, this.shown + dt * 45);
      this.renderLine();
    }
  }

  private renderLine() {
    const full = this.lines[this.line];
    this.dialogText.textContent = full.slice(0, Math.floor(this.shown));
    this.dialogMore.style.visibility = this.shown >= full.length ? 'visible' : 'hidden';
  }

  // ---------------------------------------------------------- panel
  get panelOpen() { return !this.panelWrap.hidden; }

  openPanel(id: SectionId) {
    this.lastFocus = document.activeElement;
    this.panelContent.innerHTML = renderSection(id, this.content);
    this.panelWrap.hidden = false;
    ($('#panel') as HTMLElement).scrollTop = 0;
    ($('#panel .close') as HTMLButtonElement).focus();
  }

  closePanel() {
    if (!this.panelOpen) return;
    this.panelWrap.hidden = true;
    (this.lastFocus as HTMLElement | null)?.focus?.();
    this.onPanelClose?.();
  }

  // ---------------------------------------------------------- combat HUD
  private hud = $('#hud');
  private hpEl = $('#hud .hp');
  private hpFill = $('#hud .hp-fill');
  private hpText = $('#hud .hp-text');
  private dmgRoot = $('#dmg');

  showHud(name: string) {
    this.hud.hidden = false;
    $('#hud .hud-name').textContent = name;
  }

  private lastHp = -1;
  setHp(hp: number, max: number) {
    const shown = Math.ceil(hp);
    if (shown === this.lastHp) return;
    this.lastHp = shown;
    const r = Math.max(0, hp / max);
    this.hpFill.style.width = `${r * 100}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
    this.hpEl.classList.toggle('mid', r <= 0.5 && r > 0.25);
    this.hpEl.classList.toggle('low', r <= 0.25);
  }

  /** Floating number at a world position. */
  damageNumber(at: THREE.Vector3, text: string, kind: 'hit' | 'crit' | 'hero' | 'heal', camera: THREE.Camera) {
    const v = at.clone().project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = text;
    el.style.setProperty('--x', `${((v.x + 1) / 2) * window.innerWidth + (Math.random() - 0.5) * 24}px`);
    el.style.setProperty('--y', `${((1 - v.y) / 2) * window.innerHeight}px`);
    this.dmgRoot.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  // ---------------------------------------------------------- fishing
  private fishHintEl = $('#fish-hint');
  private fishAlertEl = $('#fish-alert');

  fishHint(text: string | null) {
    this.fishHintEl.hidden = !text;
    if (text && this.fishHintEl.textContent !== text) {
      this.fishHintEl.textContent = text;
      this.fishHintEl.classList.toggle('now', text.startsWith('BITE'));
    }
  }

  private fishMeterEl = $('#fish-meter');
  private zoneEl = this.fishMeterEl.querySelector('.zone') as HTMLElement;
  private needleEl = this.fishMeterEl.querySelector('.needle') as HTMLElement;

  fishMeter(m: { needle: number; zone: number; width: number } | null) {
    this.fishMeterEl.hidden = !m;
    if (!m) return;
    this.zoneEl.style.left = `${(m.zone - m.width / 2) * 100}%`;
    this.zoneEl.style.width = `${m.width * 100}%`;
    this.needleEl.style.left = `${m.needle * 100}%`;
    this.fishMeterEl.classList.toggle('hit', Math.abs(m.needle - m.zone) <= m.width / 2);
  }

  fishAlert(at: THREE.Vector3 | null, camera: THREE.Camera) {
    this.fishAlertEl.hidden = !at;
    if (!at) return;
    const v = at.clone().project(camera);
    const pos = `translate(${Math.round(((v.x + 1) / 2) * window.innerWidth) - 23}px, ${Math.round(((1 - v.y) / 2) * window.innerHeight) - 46}px)`;
    this.fishAlertEl.style.transform = pos;
    this.fishAlertEl.style.setProperty('--pos', pos);
  }

  // ---------------------------------------------------------- floating labels
  setLabels(items: Interactable[]) {
    const root = $('#labels');
    for (const it of items) {
      const el = document.createElement('div');
      el.className = `label label-${it.kind}`;
      el.innerHTML = `<span class="t">${esc(it.label)}</span><span class="key">[E]</span>`;
      root.appendChild(el);
      this.labels.set(it.id, el);
    }
  }

  updateLabels(items: Interactable[], camera: THREE.Camera, nearId: string | null, hidden: boolean) {
    const v = new THREE.Vector3();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const it of items) {
      const el = this.labels.get(it.id)!;
      v.set(...it.labelPos).project(camera);
      const near = it.id === nearId;
      const visible = !hidden && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (it.kind === 'door' || near);
      el.classList.toggle('show', visible);
      el.classList.toggle('near', near);
      if (!visible) continue;
      const half = el.offsetWidth / 2 + 8;
      const sx = Math.min(w - half, Math.max(half, ((v.x + 1) / 2) * w));
      const sy = Math.max(el.offsetHeight + 8, ((1 - v.y) / 2) * h);
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
    }
  }
}
