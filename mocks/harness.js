/*
 * Mock harness behaviour. Two jobs only:
 *   1. flip every .screen on the page between the light and dark theme, and
 *   2. keep the harness's own switch in sync.
 * Nothing here is production code; `mocks/` is a design spike.
 */
(function () {
  const switches = document.querySelectorAll("[data-theme-switch]");
  if (switches.length === 0) return;

  const apply = (theme) => {
    for (const s of document.querySelectorAll(".screen")) {
      s.setAttribute("data-theme", theme);
    }
    for (const sw of switches) {
      for (const b of sw.querySelectorAll("button")) {
        b.setAttribute("aria-pressed", String(b.dataset.set === theme));
      }
    }
  };

  for (const sw of switches) {
    sw.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-set]");
      if (btn) apply(btn.dataset.set);
    });
  }
})();
