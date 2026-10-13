/** Inline line icons (stroke = currentColor) and the Boing logo. */
const svg = (body: string, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS: Record<string, string> = {
  // A parabola with the body at its apex: the idea behind the measurement.
  logo: `<svg viewBox="0 0 32 32"><path d="M4 27 Q16 -7 28 27" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/><circle cx="16" cy="10" r="4" fill="var(--accent)"/></svg>`,
  menu: svg(`<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  film: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>`),
  flip: svg(`<path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/>`),
  soundOn: svg(`<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>`),
  soundOff: svg(`<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>`),
};

/** Fill every element with a data-icon attribute. */
export function renderIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon!] ?? "";
  });
}
