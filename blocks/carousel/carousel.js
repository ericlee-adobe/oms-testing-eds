import { createOptimizedPicture } from '../../scripts/aem.js';

/**
 * Resolves the image cell into a <picture> or <img>.
 * Authored images arrive as a <picture>; externally referenced images arrive
 * as a link or plain text URL, which we render as a simple <img>.
 * @param {Element} cell The image cell
 * @param {string} alt Fallback alt text
 * @param {boolean} eager Whether to load eagerly (first slide)
 * @returns {Element|null}
 */
function buildImage(cell, alt, eager) {
  if (!cell) return null;
  const picture = cell.querySelector('picture');
  if (picture) {
    const img = picture.querySelector('img');
    if (img) img.loading = eager ? 'eager' : 'lazy';
    return picture;
  }
  const link = cell.querySelector('a');
  const src = (link ? link.getAttribute('href') : cell.textContent).trim();
  if (!src) return null;
  // same-origin/relative images can be optimized, external ones are used as-is
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin) {
      return createOptimizedPicture(src, alt, eager, [{ width: '1920' }]);
    }
  } catch (e) {
    return null;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.loading = eager ? 'eager' : 'lazy';
  return img;
}

/**
 * Builds a single slide from a table row.
 * Columns: eyebrow, title, body, image, button label, button link.
 * @param {Element} row The block row
 * @param {number} index Zero-based slide index
 * @returns {HTMLLIElement}
 */
function buildSlide(row, index) {
  const [eyebrowCell, titleCell, bodyCell, imageCell, labelCell, linkCell] = row.children;

  const slide = document.createElement('li');
  slide.className = 'carousel-slide';
  slide.dataset.slideIndex = index;
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-roledescription', 'slide');

  const titleText = titleCell ? titleCell.textContent.trim() : '';

  const image = buildImage(imageCell, titleText, index === 0);
  if (image) {
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'carousel-slide-image';
    imageWrapper.append(image);
    slide.append(imageWrapper);
  }

  const content = document.createElement('div');
  content.className = 'carousel-slide-content';

  const eyebrowText = eyebrowCell ? eyebrowCell.textContent.trim() : '';
  if (eyebrowText) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'carousel-slide-eyebrow';
    eyebrow.textContent = eyebrowText;
    content.append(eyebrow);
  }

  if (titleText) {
    const title = document.createElement('h2');
    title.className = 'carousel-slide-title';
    title.textContent = titleText;
    content.append(title);
    slide.setAttribute('aria-label', titleText);
  }

  const bodyText = bodyCell ? bodyCell.textContent.trim() : '';
  if (bodyText) {
    const body = document.createElement('div');
    body.className = 'carousel-slide-body';
    if (bodyCell.children.length) {
      // authored as real rich text elements
      body.append(...bodyCell.childNodes);
    } else if (/<[a-z][\s\S]*>/i.test(bodyText)) {
      // authored as markup typed into a plain cell (e.g. "<p>...</p>")
      body.innerHTML = bodyText;
    } else {
      const p = document.createElement('p');
      p.textContent = bodyText;
      body.append(p);
    }
    content.append(body);
  }

  const label = labelCell ? labelCell.textContent.trim() : '';
  const linkAnchor = linkCell ? linkCell.querySelector('a') : null;
  let href = '';
  if (linkAnchor) href = linkAnchor.getAttribute('href');
  else if (linkCell) href = linkCell.textContent;
  href = href.trim();
  if (label && href) {
    const buttonWrapper = document.createElement('p');
    buttonWrapper.className = 'button-wrapper';
    const button = document.createElement('a');
    button.className = 'button';
    button.href = href;
    button.textContent = label;
    button.setAttribute('aria-label', `${label} ${titleText}`.trim());
    buttonWrapper.append(button);
    content.append(buttonWrapper);
  }

  slide.append(content);
  return slide;
}

/**
 * Creates a nav button (previous/next arrow).
 * @param {string} direction 'prev' or 'next'
 * @returns {HTMLButtonElement}
 */
function buildArrow(direction) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `carousel-arrow carousel-arrow-${direction}`;
  button.setAttribute('aria-label', direction === 'prev' ? 'Previous slide' : 'Next slide');
  return button;
}

/**
 * Detects a column-label/header row. Content rows carry media (a picture, an
 * image link, or a CTA link); a label row is just plain-text column names.
 * @param {Element} row The block row
 * @returns {boolean}
 */
function isLabelRow(row) {
  return !row.querySelector('picture, img, a');
}

/**
 * loads and decorates the carousel
 * @param {Element} block The carousel block element
 */
export default function decorate(block) {
  const rows = [...block.children].filter((row) => !isLabelRow(row));
  const slides = rows.map((row, index) => buildSlide(row, index));

  const track = document.createElement('ul');
  track.className = 'carousel-slides';
  slides.forEach((slide) => track.append(slide));

  const container = document.createElement('div');
  container.className = 'carousel-slides-container';
  container.append(track);

  block.replaceChildren(container);

  // A single slide needs no navigation, autoplay, or region semantics.
  if (slides.length <= 1) return;

  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  block.setAttribute('aria-label', 'Carousel');

  let current = 0;

  const dots = document.createElement('div');
  dots.className = 'carousel-dots';
  dots.setAttribute('role', 'tablist');

  const prev = buildArrow('prev');
  const next = buildArrow('next');

  function updateUI() {
    [...dots.children].forEach((dot, index) => {
      const active = index === current;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    slides.forEach((slide, index) => {
      slide.classList.toggle('carousel-slide-active', index === current);
    });
  }

  function goToSlide(index) {
    current = (index + slides.length) % slides.length;
    track.scrollTo({ left: track.clientWidth * current, behavior: 'smooth' });
    updateUI();
  }

  slides.forEach((slide, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
    dot.addEventListener('click', () => goToSlide(index));
    dots.append(dot);
  });

  prev.addEventListener('click', () => goToSlide(current - 1));
  next.addEventListener('click', () => goToSlide(current + 1));

  // keep the active state in sync when the user swipes/scrolls manually
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        current = Number(entry.target.dataset.slideIndex);
        updateUI();
      }
    });
  }, { root: track, threshold: 0.6 });
  slides.forEach((slide) => observer.observe(slide));

  block.append(prev, next, dots);
  updateUI();

  // optional autoplay via the `autoplay` block variant, pausing on interaction
  if (block.classList.contains('autoplay')) {
    let timer;
    const delay = 5000;
    const start = () => { timer = window.setInterval(() => goToSlide(current + 1), delay); };
    const stop = () => window.clearInterval(timer);
    block.addEventListener('mouseenter', stop);
    block.addEventListener('mouseleave', start);
    block.addEventListener('focusin', stop);
    block.addEventListener('focusout', start);
    start();
  }
}
