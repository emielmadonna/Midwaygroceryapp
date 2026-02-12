/* ═══════════════════════════════════════
   MAIN APP — Midway Gas & Grocery
   ═══════════════════════════════════════ */

import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';
import './styles/sections.css';
import './styles/animations.css';

import {
  getFuelPrices,
  getHours,
  getProducts,
  getSettings,
  getTodayKey,
  getDayLabel,
  getDayOrder,
  isOpenNow,
  formatUpdatedTime,
  syncCloudData,
} from './data.js';

// ─── Initialize ───

document.addEventListener('DOMContentLoaded', async () => {
  // Sync with cloud FIRST before rendering
  await syncCloudData();

  initNav();
  renderFuelPrices();
  renderStoreGrid();
  renderHours();
  renderLiveStore();
  renderFooter();
  initScrollReveal();
  initSmoothScroll();
});

// ─── Navigation ───

function initNav() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');

  // Mobile toggle
  toggle?.addEventListener('click', () => {
    toggle.classList.toggle('active');
    links.classList.toggle('open');
  });

  // Close menu on link click
  links?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('active');
      links.classList.remove('open');
    });
  });

  // Scroll effect
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    if (scrollY > 50) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
    lastScroll = scrollY;
  }, { passive: true });
}

// ─── Fuel Prices ───

function renderFuelPrices() {
  const fuel = getFuelPrices();

  // Hero prices
  const heroUnleaded = document.getElementById('heroUnleaded');
  const heroDiesel = document.getElementById('heroDiesel');
  if (heroUnleaded) heroUnleaded.textContent = `$${fuel.unleaded}`;
  if (heroDiesel) heroDiesel.textContent = `$${fuel.diesel}`;

  // Fuel section prices
  const fuelUnleaded = document.getElementById('fuelUnleaded');
  const fuelDiesel = document.getElementById('fuelDiesel');
  if (fuelUnleaded) fuelUnleaded.textContent = fuel.unleaded;
  if (fuelDiesel) fuelDiesel.textContent = fuel.diesel;

  // Updated time
  const fuelUpdated = document.getElementById('fuelUpdated');
  if (fuelUpdated) fuelUpdated.textContent = formatUpdatedTime(fuel.updatedAt);
}

// ─── Store Grid ───

function renderStoreGrid() {
  const grid = document.getElementById('storeGrid');
  if (!grid) return;

  const products = getProducts();

  grid.innerHTML = products.map(product => `
    <div class="store__item reveal">
      <span class="store__item-icon">${product.icon}</span>
      <span class="store__item-name">${product.name}</span>
    </div>
  `).join('');
}

// ─── Hours ───

function renderHours() {
  const scheduleEl = document.getElementById('hoursSchedule');
  const statusEl = document.getElementById('hoursStatus');

  if (!scheduleEl) return;

  const hours = getHours();
  const today = getTodayKey();
  const dayOrder = getDayOrder();

  // Grouping logic
  const groups = [];
  let currentGroup = null;

  dayOrder.forEach((day, index) => {
    const dayHours = hours[day];
    const timeStr = `${dayHours.open} – ${dayHours.close}`;

    if (currentGroup && currentGroup.time === timeStr) {
      currentGroup.days.push(day);
    } else {
      currentGroup = {
        days: [day],
        time: timeStr
      };
      groups.push(currentGroup);
    }
  });

  // Render grouped schedule
  scheduleEl.innerHTML = groups.map(group => {
    const isTodayInGroup = group.days.includes(today);
    const dayLabel = group.days.length > 1
      ? `${getDayLabel(group.days[0])} – ${getDayLabel(group.days[group.days.length - 1])}`
      : getDayLabel(group.days[0]);

    return `
      <div class="hours__row ${isTodayInGroup ? 'hours__row--today' : ''}">
        <div class="hours__day-wrap">
          <span class="hours__day">${dayLabel}</span>
          ${isTodayInGroup ? '<span class="hours__today-badge">Today</span>' : ''}
        </div>
        <div class="hours__time-wrap">
          <span class="hours__time">${group.time}</span>
        </div>
      </div>
    `;
  }).join('');

  // Open/Closed status
  if (statusEl) {
    const open = isOpenNow();
    statusEl.className = `hours__status hours__status--${open ? 'open' : 'closed'}`;
    statusEl.querySelector('.hours__status-text').textContent = open ? 'Open Now' : 'Closed';
  }
}

// ─── Footer ───

function renderLiveStore() {
  const grid = document.getElementById('liveStoreGrid');
  const storeData = window.midway_live_store || [];

  if (!grid) return;

  if (storeData.length === 0) {
    grid.innerHTML = '<div class="store__loading">No live items currently highlighted.</div>';
    return;
  }

  grid.innerHTML = storeData.map(item => `
        <div class="store__live-item reveal">
            <span class="store__live-emoji">${item.emoji || '🛒'}</span>
            <span class="store__live-name">${item.name}</span>
            <span class="store__live-price">$${Number(item.price).toFixed(2)}</span>
        </div>
    `).join('');
}

function renderFooter() {
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const settings = getSettings();
  const ownedEl = document.getElementById('footerOwned');
  if (ownedEl && settings.locallyOwnedSince) {
    ownedEl.textContent = `Locally owned since ${settings.locallyOwnedSince}`;
  }
}

// ─── Scroll Reveal (IntersectionObserver) ───

function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');

  if (!reveals.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  reveals.forEach(el => observer.observe(el));
}

// ─── Smooth Scroll ───

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}
