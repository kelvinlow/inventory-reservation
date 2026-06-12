import './style.css';
import { api } from './lib/api';
import { getProductIcon } from './lib/constants';
import type { Order, Product, Reservation } from './lib/types';
import {
  formatCountdown,
  formatDate,
  formatRelativeTime,
  generateIdempotencyKey,
  getSecondsRemaining,
  getStockLabel,
} from './lib/utils';

interface AppState {
  products: Product[];
  loadingProducts: boolean;
  activeReservation: Reservation | null;
  activeOrder: Order | null;
  reservationError: string | null;
  generalError: string | null;
  notice: string | null;
  reserveSku: string;
  reserveQuantity: number;
  reserveUserId: string;
  confirming: boolean;
  cancelling: boolean;
  adminApiKey: string;
  adminReservations: Reservation[];
  adminOrders: Order[];
  adminLoading: boolean;
}

const state: AppState = {
  products: [],
  loadingProducts: true,
  activeReservation: null,
  activeOrder: null,
  reservationError: null,
  generalError: null,
  notice: null,
  reserveSku: '',
  reserveQuantity: 1,
  reserveUserId: '',
  confirming: false,
  cancelling: false,
  adminApiKey: '',
  adminReservations: [],
  adminOrders: [],
  adminLoading: false,
};

const app = document.querySelector<HTMLDivElement>('#root');

if (!app) {
  throw new Error('Root element not found');
}

const root = app;

function setState(next: Partial<AppState>): void {
  Object.assign(state, next);
  render();
}

function readStoredReservationId(): string | null {
  return window.localStorage.getItem('inventory-active-reservation');
}

function storeReservationId(id: string | null): void {
  if (id) {
    window.localStorage.setItem('inventory-active-reservation', id);
  } else {
    window.localStorage.removeItem('inventory-active-reservation');
  }
}

async function refreshProducts(): Promise<void> {
  setState({ loadingProducts: true, generalError: null });
  try {
    const products = await api.listProducts();
    setState({ products, loadingProducts: false });
  } catch (error) {
    setState({
      loadingProducts: false,
      generalError: error instanceof Error ? error.message : 'Failed to load products',
    });
  }
}

async function loadStoredReservation(): Promise<void> {
  const reservationId = readStoredReservationId();
  if (!reservationId) return;

  try {
    const reservation = await api.getReservation(reservationId);
    setState({ activeReservation: reservation, reservationError: null });
  } catch {
    storeReservationId(null);
  }
}

async function reserveProduct(sku: string): Promise<void> {
  setState({ reservationError: null, notice: null });

  try {
    const reservation = await api.createReservation({
      sku,
      quantity: state.reserveQuantity,
      user_id: state.reserveUserId.trim() || undefined,
    });

    storeReservationId(reservation.id);
    setState({
      activeReservation: reservation,
      activeOrder: null,
      reserveSku: sku,
      notice: `Reservation ${reservation.id.slice(0, 8)} created.`,
    });

    await refreshProducts();
  } catch (error) {
    setState({
      reservationError: error instanceof Error ? error.message : 'Reservation failed',
    });
  }
}

async function refreshActiveReservation(): Promise<void> {
  if (!state.activeReservation) return;

  try {
    const reservation = await api.getReservation(state.activeReservation.id);
    setState({ activeReservation: reservation });
    if (reservation.status !== 'pending') {
      await refreshProducts();
    }
  } catch (error) {
    setState({
      reservationError: error instanceof Error ? error.message : 'Failed to refresh reservation',
    });
  }
}

async function confirmActiveReservation(): Promise<void> {
  if (!state.activeReservation) return;

  setState({ confirming: true, reservationError: null, notice: null });
  try {
    const paymentReference = `demo-${generateIdempotencyKey().slice(0, 12)}`;
    const result = await api.confirmReservation(state.activeReservation.id, {
      payment_reference: paymentReference,
    });

    storeReservationId(result.reservation.id);
    setState({
      activeReservation: result.reservation,
      activeOrder: result.order,
      confirming: false,
      notice: `Reservation confirmed. Order ${result.order.id.slice(0, 8)} created.`,
    });

    await refreshProducts();
  } catch (error) {
    setState({
      confirming: false,
      reservationError: error instanceof Error ? error.message : 'Confirmation failed',
    });
  }
}

async function cancelActiveReservation(): Promise<void> {
  if (!state.activeReservation) return;

  setState({ cancelling: true, reservationError: null, notice: null });
  try {
    const reservation = await api.cancelReservation(state.activeReservation.id);
    storeReservationId(reservation.status === 'cancelled' ? null : reservation.id);
    setState({
      activeReservation: reservation,
      activeOrder: null,
      cancelling: false,
      notice: `Reservation ${reservation.id.slice(0, 8)} cancelled.`,
    });

    if (reservation.status === 'cancelled') {
      storeReservationId(null);
    }

    await refreshProducts();
  } catch (error) {
    setState({
      cancelling: false,
      reservationError: error instanceof Error ? error.message : 'Cancellation failed',
    });
  }
}

async function loadAdminViews(): Promise<void> {
  if (!state.adminApiKey.trim()) {
    setState({ generalError: 'Enter an admin API key to load admin data.' });
    return;
  }

  setState({ adminLoading: true, generalError: null });
  try {
    const [reservations, orders] = await Promise.all([
      api.listReservations(state.adminApiKey),
      api.listOrders(state.adminApiKey),
    ]);

    setState({
      adminReservations: reservations.data,
      adminOrders: orders.data,
      adminLoading: false,
      notice: 'Admin data refreshed.',
    });
  } catch (error) {
    setState({
      adminLoading: false,
      generalError: error instanceof Error ? error.message : 'Failed to load admin data',
    });
  }
}

function getAvailableUnits(): number {
  return state.products.reduce((sum, product) => sum + product.available_stock, 0);
}

function getHeldUnits(): number {
  return state.products.reduce((sum, product) => sum + product.reserved_count, 0);
}

function getConfirmedUnits(): number {
  return state.products.reduce((sum, product) => sum + product.confirmed_count, 0);
}

function getReadyCount(): number {
  return state.products.filter((product) => product.available_stock > 0).length;
}

function getProductTone(product: Product): 'good' | 'warn' | 'danger' {
  if (product.available_stock <= 0) return 'danger';
  if (product.available_stock <= 5 || product.available_stock <= Math.ceil(product.total_stock * 0.2)) {
    return 'warn';
  }
  return 'good';
}

function getProgressWidth(product: Product): number {
  if (product.total_stock <= 0) return 0;
  return Math.max(4, Math.round((product.available_stock / product.total_stock) * 100));
}

function renderGuidedSteps(): string {
  const steps = [
    {
      index: '1',
      title: 'Choose a SKU',
      body: 'Select a product from the dropdown or tap "Use in form" on any card below.',
    },
    {
      index: '2',
      title: 'Set a quantity',
      body: 'Enter how many units you want to hold. The app keeps it within the available stock.',
    },
    {
      index: '3',
      title: 'Add a reference',
      body: 'Optional: type a customer or user reference so the reservation is easy to trace later.',
    },
    {
      index: '4',
      title: 'Reserve and review',
      body: 'Submit the hold, then confirm or cancel it from the reservation panel when you are ready.',
    },
  ];

  return steps
    .map(
      (step) => `
        <li class="step-item">
          <span class="step-index">${step.index}</span>
          <div>
            <h3>${step.title}</h3>
            <p>${step.body}</p>
          </div>
        </li>
      `,
    )
    .join('');
}

function renderProducts(): string {
  if (state.loadingProducts) {
    return `
      <div class="panel dashboard-empty">
        <div class="loading-ring" aria-hidden="true"></div>
        <h3>Loading products</h3>
        <p>Fetching live stock so you can reserve against current availability.</p>
      </div>
    `;
  }

  if (state.generalError && state.products.length === 0) {
    return `
      <div class="panel dashboard-empty error">
        <div class="dashboard-empty-icon" aria-hidden="true">!</div>
        <h3>Unable to load products</h3>
        <p>${escapeHtml(state.generalError)}</p>
        <button class="btn primary" data-action="refresh-products">Try again</button>
      </div>
    `;
  }

  if (state.products.length === 0) {
    return `
      <div class="panel dashboard-empty">
        <div class="dashboard-empty-icon" aria-hidden="true">📦</div>
        <h3>No products available yet</h3>
        <p>Once products are seeded, they will appear here with live stock and reservation actions.</p>
      </div>
    `;
  }

  return state.products
    .map((product) => {
      const tone = getProductTone(product);
      const disabled = product.available_stock <= 0 ? 'disabled' : '';
      const active = state.reserveSku === product.sku ? 'active' : '';
      const stockLabel = getStockLabel(product.available_stock);
      const progressWidth = getProgressWidth(product);

      return `
        <article class="product-card ${active}" aria-label="${escapeHtml(product.name)}">
          <div class="product-card-head">
            <div class="product-topline">
              <span class="pill sku">${escapeHtml(product.sku)}</span>
              <span class="pill ${tone}">${escapeHtml(stockLabel)}</span>
            </div>
            <div class="product-icon" aria-hidden="true">${getProductIcon(product.id)}</div>
          </div>

          <div class="product-body">
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description ?? 'No description provided.')}</p>
          </div>

          <div class="product-selected-hint ${active ? 'visible' : ''}">
            ${active ? 'Selected for reservation' : 'Tap “Use in form” to prefill the reservation draft.'}
          </div>

          <dl class="stock-grid">
            <div>
              <dt>Available</dt>
              <dd class="${tone}">${product.available_stock}</dd>
            </div>
            <div>
              <dt>Reserved</dt>
              <dd>${product.reserved_count}</dd>
            </div>
            <div>
              <dt>Confirmed</dt>
              <dd>${product.confirmed_count}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>${product.total_stock}</dd>
            </div>
          </dl>

          <div class="stock-bar" aria-hidden="true">
            <span class="${tone}" style="width: ${progressWidth}%"></span>
          </div>

          <div class="product-actions">
            <button class="btn secondary" data-action="select-product" data-sku="${escapeHtml(product.sku)}">
              Use in form
            </button>
            <button class="btn primary" data-action="reserve" data-sku="${escapeHtml(product.sku)}" ${disabled}>
              ${product.available_stock > 0 ? 'Reserve now' : 'Out of stock'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderReservation(): string {
  if (!state.activeReservation) {
    return `
      <div class="panel reservation-panel">
        <div class="reservation-panel-header">
          <div>
            <div class="eyebrow">Reservation workspace</div>
            <h2>No active reservation yet</h2>
          </div>
          <span class="pill neutral">Ready</span>
        </div>
        <p class="muted">
          Use the form above to create a hold. When one is active, the countdown and next actions appear here.
        </p>
        <div class="reservation-help-grid">
          <div class="guide-card">
            <span class="guide-card-index">1</span>
            <p>Choose a SKU from the form or product card.</p>
          </div>
          <div class="guide-card">
            <span class="guide-card-index">2</span>
            <p>Set the quantity and optional customer reference.</p>
          </div>
          <div class="guide-card">
            <span class="guide-card-index">3</span>
            <p>Reserve the stock, then confirm or cancel it later.</p>
          </div>
        </div>
      </div>
    `;
  }

  const reservationProduct = state.products.find((product) => product.sku === state.activeReservation?.sku_id);
  const secondsRemaining = getSecondsRemaining(state.activeReservation.expires_at);
  const countdown = formatCountdown(secondsRemaining);
  const countdownTone =
    state.activeReservation.status !== 'pending'
      ? 'neutral'
      : secondsRemaining <= 30
        ? 'danger'
        : secondsRemaining <= 120
          ? 'warn'
          : 'good';
  const statusText =
    state.activeReservation.status === 'pending'
      ? 'Active'
      : state.activeReservation.status === 'confirmed'
        ? 'Confirmed'
        : state.activeReservation.status === 'cancelled'
          ? 'Cancelled'
          : 'Expired';

  return `
    <div class="panel reservation-panel">
      <div class="reservation-panel-header">
        <div>
          <div class="eyebrow">Active reservation</div>
          <h2>${escapeHtml(state.activeReservation.id)}</h2>
        </div>
        <span class="pill ${countdownTone}">${escapeHtml(statusText)}</span>
      </div>

      <div class="reservation-highlight">
        <div>
          <span class="meta-label">Reserved item</span>
          <strong>${escapeHtml(reservationProduct?.name ?? state.activeReservation.sku_id)}</strong>
          <p>SKU: ${escapeHtml(state.activeReservation.sku_id)}</p>
        </div>
        <div class="reservation-timer">
          <span class="meta-label">Time left</span>
          <strong
            class="${countdownTone}"
            data-countdown-expires-at="${escapeHtml(state.activeReservation.expires_at)}"
            data-reservation-status="${escapeHtml(state.activeReservation.status)}"
          >
            ${countdown}
          </strong>
          <p>Reservation holds expire automatically after 10 minutes.</p>
        </div>
      </div>

      <div class="reservation-grid">
        <div>
          <span class="meta-label">Quantity</span>
          <strong>${state.activeReservation.quantity}</strong>
        </div>
        <div>
          <span class="meta-label">Created</span>
          <strong>${escapeHtml(formatDate(state.activeReservation.created_at))}</strong>
        </div>
        <div>
          <span class="meta-label">Expires at</span>
          <strong>${escapeHtml(formatDate(state.activeReservation.expires_at))}</strong>
        </div>
        <div>
          <span class="meta-label">Status</span>
          <strong class="${countdownTone}">${escapeHtml(state.activeReservation.status)}</strong>
        </div>
      </div>

      <div class="reservation-grid reservation-grid-secondary">
        <div>
          <span class="meta-label">Reservation ID</span>
          <strong>${escapeHtml(state.activeReservation.id)}</strong>
        </div>
        <div>
          <span class="meta-label">SKU</span>
          <strong>${escapeHtml(state.activeReservation.sku_id)}</strong>
        </div>
      </div>

      ${
        state.activeOrder
          ? `<div class="notice success">Order ${escapeHtml(state.activeOrder.id)} is linked to this reservation.</div>`
          : ''
      }
      ${!state.activeOrder && state.activeReservation.status === 'pending'
        ? `<div class="notice info">Next step: confirm the reservation to create the order, or cancel it to release stock.</div>`
        : ''}
      <div class="toolbar">
        <button class="btn secondary" data-action="refresh-reservation">Refresh</button>
        <button class="btn primary" data-action="confirm-reservation" ${
          state.activeReservation.status !== 'pending' || state.confirming ? 'disabled' : ''
        }>
          ${state.confirming ? 'Confirming…' : 'Confirm Reservation'}
        </button>
        <button class="btn danger" data-action="cancel-reservation" ${
          state.activeReservation.status !== 'pending' || state.cancelling ? 'disabled' : ''
        }>
          ${state.cancelling ? 'Cancelling…' : 'Cancel Reservation'}
        </button>
      </div>
    </div>
  `;
}

function renderAdmin(): string {
  const reservationRows = state.adminReservations
    .slice(0, 6)
    .map(
      (reservation) => `
        <tr>
          <td>${escapeHtml(reservation.id.slice(0, 8))}</td>
          <td>${escapeHtml(reservation.sku_id.slice(0, 8))}</td>
          <td>${reservation.quantity}</td>
          <td>${escapeHtml(reservation.status)}</td>
          <td data-relative-time="${escapeHtml(reservation.created_at)}">${escapeHtml(formatRelativeTime(reservation.created_at))}</td>
        </tr>
      `,
    )
    .join('');

  const orderRows = state.adminOrders
    .slice(0, 6)
    .map(
      (order) => `
        <tr>
          <td>${escapeHtml(order.id.slice(0, 8))}</td>
          <td>${escapeHtml(order.reservation_id.slice(0, 8))}</td>
          <td>${escapeHtml(order.status)}</td>
          <td>${escapeHtml(order.payment_reference ?? '-')}</td>
          <td data-relative-time="${escapeHtml(order.created_at)}">${escapeHtml(formatRelativeTime(order.created_at))}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <section class="panel admin-panel">
      <div class="section-header">
        <div>
          <div class="eyebrow">Admin surface</div>
          <h2>Operator controls</h2>
        </div>
        <button class="btn secondary" data-action="admin-refresh" ${state.adminLoading ? 'disabled' : ''}>
          ${state.adminLoading ? 'Refreshing…' : 'Refresh tables'}
        </button>
      </div>
      <p class="muted">
        Paste an admin API key to inspect reservations and orders. Use the Worker admin endpoints for stock adjustments.
      </p>
      <div class="admin-key-row">
        <label class="field">
          <span class="meta-label">Admin API key</span>
          <input id="admin-api-key" class="input" placeholder="Paste API key here" value="${escapeHtml(state.adminApiKey)}" />
        </label>
      </div>
      <div class="table-grid">
        <div class="table-card">
          <h3>Recent Reservations</h3>
          <table>
            <thead>
              <tr><th>Reservation</th><th>SKU Id</th><th>Qty</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>${reservationRows || `<tr><td colspan="5" class="empty-cell">No admin data loaded.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="table-card">
          <h3>Recent Orders</h3>
          <table>
            <thead>
              <tr><th>Order</th><th>Reservation</th><th>Status</th><th>Payment</th><th>Created</th></tr>
            </thead>
            <tbody>${orderRows || `<tr><td colspan="5" class="empty-cell">No orders loaded.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function render(): void {
  const selectedProduct = state.products.find((product) => product.sku === state.reserveSku);
  const selectedTone = selectedProduct ? getProductTone(selectedProduct) : 'neutral';
  const selectedAvailable = selectedProduct?.available_stock ?? 0;
  const selectedLabel = selectedProduct ? getStockLabel(selectedProduct.available_stock) : 'Choose a SKU';
  const readyCount = getReadyCount();
  const confirmedUnits = getConfirmedUnits();

  root.innerHTML = `
    <div class="shell" id="top">
      <nav class="top-nav" aria-label="Primary">
        <a class="brand" href="#top">
          <span class="brand-mark" aria-hidden="true">📦</span>
          <span class="brand-copy">
            <strong>Everest</strong>
            <small>Inventory Reservation</small>
          </span>
        </a>
        <div class="nav-links">
          <a href="#catalog">Catalog</a>
          <a href="#reservation">Reservation</a>
          <a href="#admin">Admin</a>
        </div>
      </nav>

      <header class="hero">
        <div class="hero-copy">
          <div class="eyebrow">Cloudflare Pages + Workers</div>
          <h1>Inventory Reservation System</h1>
          <p>
            A guided reservation flow for beginners: pick a SKU, set quantity, add an optional reference, and hold stock without overselling.
          </p>
          <div class="hero-callout">
            <strong>Beginner-friendly flow</strong>
            <p>
              Every step is shown on screen. ${readyCount} product${readyCount === 1 ? ' is' : 's are'} ready to reserve right now.
            </p>
          </div>
          <div class="hero-metrics">
            <div class="metric-card">
              <span>SKUs</span>
              <strong>${state.products.length}</strong>
            </div>
            <div class="metric-card">
              <span>Available units</span>
              <strong>${getAvailableUnits()}</strong>
            </div>
            <div class="metric-card">
              <span>Held units</span>
              <strong>${getHeldUnits()}</strong>
            </div>
            <div class="metric-card">
              <span>Confirmed units</span>
              <strong>${confirmedUnits}</strong>
            </div>
          </div>
        </div>
        <div class="hero-panel">
          <div class="reservation-panel-header">
            <div>
              <div class="eyebrow">Start here</div>
              <h2>Make a reservation in 4 steps</h2>
            </div>
            <span class="pill accent">Guided</span>
          </div>

          <ol class="step-list">
            ${renderGuidedSteps()}
          </ol>

          <div class="draft-card">
            <div class="draft-card-header">
              <div>
                <span class="meta-label">Selected SKU</span>
                <h3>${escapeHtml(selectedProduct?.name ?? 'Choose a product below')}</h3>
              </div>
              <span class="pill ${selectedTone}">${escapeHtml(selectedLabel)}</span>
            </div>
            <div class="draft-card-grid">
              <div>
                <span class="meta-label">SKU</span>
                <strong>${escapeHtml(selectedProduct?.sku ?? 'None selected')}</strong>
              </div>
              <div>
                <span class="meta-label">Available</span>
                <strong class="${selectedTone}">${selectedAvailable}</strong>
              </div>
            </div>
          </div>

          <div class="form-stack">
            <label class="field">
              <span class="meta-label">SKU</span>
              <select id="reserve-sku" class="input">
                <option value="">Select a product</option>
                ${state.products
                  .map(
                    (product) => `
                      <option value="${escapeHtml(product.sku)}" ${product.sku === state.reserveSku ? 'selected' : ''}>
                        ${escapeHtml(product.sku)} · ${escapeHtml(product.name)}
                      </option>
                    `,
                  )
                  .join('')}
              </select>
              <span class="field-hint">You can also click “Use in form” on any product card.</span>
            </label>

            <div class="field-row">
              <label class="field">
                <span class="meta-label">Quantity</span>
                <input id="reserve-quantity" class="input" type="number" min="1" max="10" value="${state.reserveQuantity}" />
                <span class="field-hint">Choose how many units to hold. Maximum is 10 per reservation.</span>
              </label>

              <label class="field">
                <span class="meta-label">Customer reference</span>
                <input id="reserve-user-id" class="input" placeholder="Optional user or customer ID" value="${escapeHtml(state.reserveUserId)}" />
                <span class="field-hint">Optional. Use this to trace the hold later in support or admin views.</span>
              </label>
            </div>
          </div>

          <button class="btn primary wide" data-action="reserve-selected" ${state.reserveSku ? '' : 'disabled'}>
            Reserve selected SKU
          </button>
          <p class="panel-footnote">The hold is temporary. After reserving, the next step is to confirm or cancel it from the reservation panel.</p>
        </div>
      </header>

      ${state.notice ? `<div class="banner success">${escapeHtml(state.notice)}</div>` : ''}
      ${state.reservationError ? `<div class="banner error">${escapeHtml(state.reservationError)}</div>` : ''}
      ${state.generalError ? `<div class="banner error">${escapeHtml(state.generalError)}</div>` : ''}

      <section class="catalog" id="catalog">
        <div class="section-header">
          <div>
            <div class="eyebrow">Live Catalog</div>
            <h2>Browse products</h2>
            <p>Click a card to load it into the reservation form, or reserve it directly if you are ready.</p>
          </div>
          <button class="btn secondary" data-action="refresh-products">Refresh Stock</button>
        </div>
        <div class="catalog-note">Stock updates happen in real time when you refresh or create a hold.</div>
        <div class="product-grid">${renderProducts()}</div>
      </section>

      <section class="workflow" id="reservation">
        ${renderReservation()}
      </section>

      <div id="admin">
        ${renderAdmin()}
      </div>
    </div>
  `;

  attachEvents();
}

function attachEvents(): void {
  document.querySelector('#reserve-sku')?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    setState({ reserveSku: target.value, reservationError: null, generalError: null });
  });

  document.querySelector('#reserve-quantity')?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const value = Number.parseInt(target.value, 10);
    setState({ reserveQuantity: Number.isNaN(value) ? 1 : Math.max(1, Math.min(10, value)) });
  });

  document.querySelector('#reserve-user-id')?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    setState({ reserveUserId: target.value });
  });

  document.querySelector('#admin-api-key')?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    setState({ adminApiKey: target.value, generalError: null });
  });

  document.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    element.addEventListener('click', async () => {
      const action = element.dataset.action;
      const sku = element.dataset.sku;

      switch (action) {
        case 'refresh-products':
          await refreshProducts();
          break;
        case 'select-product':
          if (sku) setState({ reserveSku: sku, notice: null, reservationError: null });
          break;
        case 'reserve':
          if (sku) {
            setState({ reserveSku: sku });
            await reserveProduct(sku);
          }
          break;
        case 'reserve-selected':
          if (state.reserveSku) {
            await reserveProduct(state.reserveSku);
          }
          break;
        case 'refresh-reservation':
          await refreshActiveReservation();
          break;
        case 'confirm-reservation':
          await confirmActiveReservation();
          break;
        case 'cancel-reservation':
          await cancelActiveReservation();
          break;
        case 'admin-refresh':
          await loadAdminViews();
          break;
        default:
          break;
      }
    });
  });
}

function updateDynamicContent(): void {
  document.querySelectorAll<HTMLElement>('[data-countdown-expires-at]').forEach((element) => {
    const expiresAt = element.dataset.countdownExpiresAt;
    const reservationStatus = element.dataset.reservationStatus;
    if (!expiresAt) return;

    const secondsRemaining = getSecondsRemaining(expiresAt);
    const countdown = formatCountdown(secondsRemaining);
    const tone =
      reservationStatus && reservationStatus !== 'pending'
        ? 'neutral'
        : secondsRemaining <= 0
        ? 'danger'
        : secondsRemaining <= 30
          ? 'danger'
          : secondsRemaining <= 120
            ? 'warn'
            : 'good';

    element.textContent = countdown;
    element.classList.remove('good', 'warn', 'danger', 'neutral');
    element.classList.add(tone);
  });

  document.querySelectorAll<HTMLElement>('[data-relative-time]').forEach((element) => {
    const value = element.dataset.relativeTime;
    if (!value) return;

    element.textContent = formatRelativeTime(value);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

render();
void refreshProducts();
void loadStoredReservation();
window.setInterval(() => {
  updateDynamicContent();
}, 1000);
