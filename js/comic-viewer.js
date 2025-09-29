// js/comic-viewer.js
(function () {
  // ---------------------------
  // 1) Footer year auto-update
  // ---------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  });

  // -------------------------------------------------
  // 2) Scroll-reactive nav (active link + shrink nav)
  // -------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("nav");
    const navLinks = Array.from(document.querySelectorAll("nav a[href^='#']"));

    // Map section id -> nav link
    const linkById = new Map(
      navLinks
        .map(a => [a.getAttribute("href")?.slice(1) || "", a])
        .filter(([id]) => !!id)
    );

    // Sections we care about (ids present in the page)
    const sections = Array.from(linkById.keys())
      .map(id => document.getElementById(id))
      .filter(Boolean);

    // Visually mark active link
    function setActive(id) {
      navLinks.forEach(a => {
        a.classList.remove("active");
        a.removeAttribute("aria-current");
      });
      const link = linkById.get(id);
      if (link) {
        link.classList.add("active");
        link.setAttribute("aria-current", "true");
      }
    }

    // IntersectionObserver to detect which section is "most visible"
    // Use a root margin to account for the fixed/sticky nav height.
    const navHeight = (nav?.offsetHeight || 0);
    const visible = new Map(); // id -> intersection ratio

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.id;
        visible.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
      });

      // Pick the section with the highest ratio
      let bestId = null, bestRatio = 0;
      for (const [id, ratio] of visible.entries()) {
        if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
      }
      if (bestId) setActive(bestId);
    }, {
      root: null,
      rootMargin: `-${Math.max(navHeight, 0) + 8}px 0px -40% 0px`,
      threshold: [0.1, 0.25, 0.5, 0.75, 0.98]
    });

    sections.forEach(sec => {
      visible.set(sec.id, 0);
      io.observe(sec);
    });

    // Shrink/elevate nav when scrolling
    function onScroll() {
      if (!nav) return;
      if (window.scrollY > 8) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();

    // Keep active state on hash navigation and on direct clicks
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && linkById.has(id)) setActive(id);
    });
    navLinks.forEach(a => {
      a.addEventListener("click", () => {
        const id = a.getAttribute("href")?.slice(1);
        if (id) setActive(id);
      });
    });
  });

  // -------------------------------------------------
  // 3) Lightbox with swipe/drag for comic panels
  // -------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const THRESHOLD = 40;        // Minimum horizontal distance to validate a swipe
    const VELOCITY_EXIT = 0.25;  // Minimum velocity to trigger a fling

    const panels = Array.from(document.querySelectorAll(".comic-panel"));
    if (!panels.length) return;

    // Resolve best image source (handles <picture>)
    const resolveSrc = (img) => img.currentSrc || img.src;

    // Build lightbox once
    const overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <button class="prev"  aria-label="Previous">‹</button>
      <img class="lightbox-img" alt="comic page"/>
      <button class="next"  aria-label="Next">›</button>
      <div class="counter"></div>
    `;
    document.body.appendChild(overlay);

    const imgEl   = overlay.querySelector(".lightbox-img");
    const closeBt = overlay.querySelector(".close");
    const prevBt  = overlay.querySelector(".prev");
    const nextBt  = overlay.querySelector(".next");
    const counter = overlay.querySelector(".counter");

    const imgs = panels.map(resolveSrc);
    let idx = 0;
    let isOpen = false;

    function preload(i) {
      const j = (i + imgs.length) % imgs.length;
      const pre = new Image();
      pre.src = imgs[j];
    }

    function update() {
      imgEl.src = imgs[idx];
      counter.textContent = `${idx + 1} / ${imgs.length}`;
      preload(idx + 1);
      preload(idx - 1);
    }

    function open(i) {
      idx = i;
      isOpen = true;
      update();
      overlay.style.display = "block";
      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("no-scroll");
    }

    function close() {
      isOpen = false;
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("no-scroll");
    }

    function go(delta) {
      idx = (idx + delta + imgs.length) % imgs.length;
      update();
    }

    // Thumbs: click + keyboard
    panels.forEach((p, i) => {
      p.style.cursor = "zoom-in";
      p.setAttribute("tabindex", "0");
      p.addEventListener("click", () => open(i));
      p.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
      });
    });

    // Buttons
    closeBt.addEventListener("click", close);
    prevBt.addEventListener("click", () => go(-1));
    nextBt.addEventListener("click", () => go(1));

    // Close when clicking the dimmed background
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (!isOpen) return;
      if (e.key === "Escape") return close();
      if (e.key === "ArrowLeft") return go(-1);
      if (e.key === "ArrowRight") return go(1);
    });

    // Swipe/drag handlers
    addSwipeHandlers(imgEl);

    function addSwipeHandlers(target) {
      let startX = 0, startY = 0, lastX = 0, lastT = 0, dragging = false;

      const onPointerDown = (e) => {
        dragging = true;
        target.setPointerCapture?.(e.pointerId);
        startX = lastX = e.clientX;
        startY = e.clientY;
        lastT = performance.now();
        target.style.transition = "none";
      };

      const onPointerMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // Ignore if vertical movement dominates (user wants to scroll)
        if (Math.abs(dy) > Math.abs(dx) * 1.2) return;

        const now = performance.now();
        const dt = (now - lastT) / 1000;
        const vx = (e.clientX - lastX) / Math.max(dt, 0.001);

        // Translate for visual feedback
        target.style.transform = `translateX(${dx}px)`;
        target.dataset.vx = String(vx);
        lastX = e.clientX;
        lastT = now;
      };

      const onPointerUp = (e) => {
        if (!dragging) return;
        dragging = false;
        const dx = e.clientX - startX;
        const vx = parseFloat(target.dataset.vx || "0");

        target.style.transition = "transform 160ms ease-out";

        // Swipe left (next)
        if (dx <= -THRESHOLD || vx <= -THRESHOLD / 0.16 || Math.abs(vx) > (window.innerWidth * VELOCITY_EXIT)) {
          target.style.transform = "translateX(-100vw)";
          setTimeout(() => { target.style.transition = "none"; target.style.transform = ""; go(1); }, 150);
        }
        // Swipe right (prev)
        else if (dx >= THRESHOLD || vx >= THRESHOLD / 0.16) {
          target.style.transform = "translateX(100vw)";
          setTimeout(() => { target.style.transition = "none"; target.style.transform = ""; go(-1); }, 150);
        }
        // Cancel: snap back
        else {
          target.style.transform = "";
          setTimeout(() => { target.style.transition = "none"; }, 160);
        }
      };

      // Unified pointer events (touch + mouse)
      target.addEventListener("pointerdown", onPointerDown, { passive: true });
      target.addEventListener("pointermove", onPointerMove, { passive: true });
      target.addEventListener("pointerup", onPointerUp, { passive: true });
      target.addEventListener("pointercancel", onPointerUp, { passive: true });
      target.addEventListener("pointerleave", onPointerUp, { passive: true });
    }
  });
})();

