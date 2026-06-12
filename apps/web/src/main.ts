import './style.css';
import { api } from './lib/api';
import type { Order, Product, Reservation } from './lib/types';
import {
  formatCountdown,
  formatDate,
  formatRelativeTime,
  generateIdempotencyKey,
  getSecondsRemaining,
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

function stockTone(product: Product): string {
  if (product.available_stock <= 0) return 'soldout';
  if (product.available_stock <= 5) return 'danger';
  if (product.available_stock <= Math.ceil(product.total_stock * 0.3)) return 'warn';
  return 'good';
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

function renderProducts(): string {
  if (state.loadingProducts) {
    return `<div class="panel empty">Loading products…</div>`;
  }

  if (state.generalError && state.products.length === 0) {
    return `<div class="panel empty error">${escapeHtml(state.generalError)}</div>`;
  }

  return state.products
    .map((product) => {
      const tone = stockTone(product);
      const disabled = product.available_stock <= 0 ? 'disabled' : '';
      const active = state.reserveSku === product.sku ? 'active' : '';

      return `
        <article class="product-card ${active}">
          <div class="product-topline">
            <span class="pill">${escapeHtml(product.sku)}</span>
            <span class="pill ${tone}">${escapeHtml(product.status)}</span>
          </div>
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description ?? 'No description provided.')}</p>
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
          <div class="product-actions">
            <button class="btn secondary" data-action="select-product" data-sku="${escapeHtml(product.sku)}">
              Prepare Hold
            </button>
            <button class="btn primary" data-action="reserve" data-sku="${escapeHtml(product.sku)}" ${disabled}>
              Reserve ${product.available_stock > 0 ? 'Now' : 'Unavailable'}
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
        <div class="eyebrow">Reservation Console</div>
        <h2>No active reservation</h2>
        <p class="muted">Select a SKU, choose a quantity, then create a timed reservation.</p>
      </div>
    `;
  }

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

  return `
    <div class="panel reservation-panel">
      <div class="reservation-header">
        <div>
          <div class="eyebrow">Active Reservation</div>
          <h2>${escapeHtml(state.activeReservation.id)}</h2>
        </div>
        <span class="pill ${countdownTone}">${escapeHtml(state.activeReservation.status)}</span>
      </div>
      <div class="reservation-grid">
        <div>
          <span class="meta-label">SKU Id</span>
          <strong>${escapeHtml(state.activeReservation.sku_id)}</strong>
        </div>
        <div>
          <span class="meta-label">Quantity</span>
          <strong>${state.activeReservation.quantity}</strong>
        </div>
        <div>
          <span class="meta-label">Created</span>
          <strong>${escapeHtml(formatDate(state.activeReservation.created_at))}</strong>
        </div>
        <div>
          <span class="meta-label">Expires In</span>
          <strong
            class="${countdownTone}"
            data-countdown-expires-at="${escapeHtml(state.activeReservation.expires_at)}"
            data-reservation-status="${escapeHtml(state.activeReservation.status)}"
          >
            ${countdown}
          </strong>
        </div>
      </div>
      ${
        state.activeOrder
          ? `<div class="notice success">Order ${escapeHtml(state.activeOrder.id)} is linked to this reservation.</div>`
          : ''
      }
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
          <div class="eyebrow">Admin Surface</div>
          <h2>Operator Controls</h2>
        </div>
        <button class="btn secondary" data-action="admin-refresh" ${state.adminLoading ? 'disabled' : ''}>
          ${state.adminLoading ? 'Refreshing…' : 'Refresh Tables'}
        </button>
      </div>
      <p class="muted">Use your admin API key to inspect live reservations and orders. Stock adjustments happen through the Worker admin endpoints.</p>
      <div class="admin-key-row">
        <input id="admin-api-key" class="input" placeholder="Admin API key" value="${escapeHtml(state.adminApiKey)}" />
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

  root.innerHTML = `
    <div class="shell">
      <header class="hero">
        <div class="hero-copy">
          <div class="eyebrow">Cloudflare Pages + Workers</div>
          <h1>Inventory Reservation System</h1>
          <p>
            High-concurrency holds backed by Durable Objects, D1 persistence, and a customer flow
            that lets you reserve, confirm, or release stock without overselling.
          </p>
          <div class="hero-metrics">
            <div><span>SKUs</span><strong>${state.products.length}</strong></div>
            <div><span>Available Units</span><strong>${state.products.reduce((sum, product) => sum + product.available_stock, 0)}</strong></div>
            <div><span>Held Units</span><strong>${state.products.reduce((sum, product) => sum + product.reserved_count, 0)}</strong></div>
          </div>
        </div>
        <div class="hero-panel">
          <div class="eyebrow">Reservation Draft</div>
          <h2>${escapeHtml(selectedProduct?.name ?? 'Choose a SKU')}</h2>
          <label>
            SKU
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
          </label>
          <label>
            Quantity
            <input id="reserve-quantity" class="input" type="number" min="1" max="10" value="${state.reserveQuantity}" />
          </label>
          <label>
            Customer Reference
            <input id="reserve-user-id" class="input" placeholder="optional user id" value="${escapeHtml(state.reserveUserId)}" />
          </label>
          <button class="btn primary wide" data-action="reserve-selected" ${state.reserveSku ? '' : 'disabled'}>
            Reserve Selected SKU
          </button>
        </div>
      </header>

      ${state.notice ? `<div class="banner success">${escapeHtml(state.notice)}</div>` : ''}
      ${state.reservationError ? `<div class="banner error">${escapeHtml(state.reservationError)}</div>` : ''}
      ${state.generalError ? `<div class="banner error">${escapeHtml(state.generalError)}</div>` : ''}

      <section class="catalog">
        <div class="section-header">
          <div>
            <div class="eyebrow">Live Catalog</div>
            <h2>Products</h2>
          </div>
          <button class="btn secondary" data-action="refresh-products">Refresh Stock</button>
        </div>
        <div class="product-grid">${renderProducts()}</div>
      </section>

      <section class="workflow">
        ${renderReservation()}
      </section>

      ${renderAdmin()}
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
