//! The reusable "How to play" guide generator (the Croft user-guide standard,
//! adapted for the games shelf). Guides are PURE DATA — an ordered list of
//! entries, each a sequence of typed blocks — so the copy is unit-tested and the
//! same entries render identically anywhere. A new game keeps the shape and
//! replaces the content (see docs/BUILDING-GAMES.md).
//!
//! Voice: explain what a thing is FOR and how you actually do it, not just where
//! a button sits. `shot` blocks name a screenshot in assets/guide/<name>.jpg,
//! regenerated from the running app by `npm run guide:shots`; a unit test fails
//! if a guide names a shot that is not on disk.

export type GuideBlock =
  | { readonly kind: "prose"; readonly text: string }
  | { readonly kind: "steps"; readonly items: readonly string[] }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "shot"; readonly name: string; readonly alt: string; readonly caption: string };

export interface GuideEntry {
  /** Stable hook for tests and TOC anchors (`/^howto-[a-z0-9-]+$/`). */
  readonly testid: string;
  readonly title: string;
  /** Short label for the table of contents. */
  readonly toc: string;
  readonly blocks: readonly GuideBlock[];
}

/** A game's complete how-to-play guide. */
export interface Guide {
  readonly title: string;
  readonly lede: string;
  readonly entries: readonly GuideEntry[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBlock(block: GuideBlock): HTMLElement {
  switch (block.kind) {
    case "prose":
      return el("p", undefined, block.text);
    case "note": {
      const note = el("p", "guide-note");
      note.append(el("strong", undefined, "Note. "), document.createTextNode(block.text));
      return note;
    }
    case "steps": {
      const list = el("ol", "guide-steps");
      for (const item of block.items) list.append(el("li", undefined, item));
      return list;
    }
    case "shot": {
      const fig = el("figure", "guide-shot");
      const img = el("img");
      img.src = `/assets/guide/${block.name}.jpg`;
      img.alt = block.alt;
      img.loading = "lazy";
      fig.append(img, el("figcaption", undefined, block.caption));
      return fig;
    }
  }
}

/** Build the guide DOM: intro (title + lede) + a table of contents + one
 *  section per entry. */
export function renderGuide(guide: Guide): HTMLElement {
  const wrap = el("div");

  const intro = el("section", "panel");
  intro.append(el("h1", undefined, guide.title), el("p", undefined, guide.lede));

  const toc = el("nav", "guide-toc");
  toc.setAttribute("aria-label", "Contents");
  const tocList = el("ul");
  for (const entry of guide.entries) {
    const li = el("li");
    const link = el("a", undefined, entry.toc);
    link.href = `#${entry.testid}`;
    li.append(link);
    tocList.append(li);
  }
  toc.append(tocList);
  intro.append(toc);
  wrap.append(intro);

  for (const entry of guide.entries) {
    const section = el("section", "panel guide-entry");
    section.id = entry.testid;
    section.setAttribute("data-testid", entry.testid);
    section.append(el("h2", undefined, entry.title));
    for (const block of entry.blocks) section.append(renderBlock(block));
    wrap.append(section);
  }

  return wrap;
}
