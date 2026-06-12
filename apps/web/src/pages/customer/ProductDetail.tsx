import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { getStockLabel, getStockBadgeVariant, clamp } from '../../lib/utils';
import { getProductIcon } from '../../lib/constants';
import type { Product } from '../../lib/types';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/Toast';

export function ProductDetail() {
  const { sku } = useParams<{ sku: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    if (!sku) return;
    loadProduct();
  }, [sku]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProduct() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getProduct(sku!);
      setProduct(data);
      document.title = `${data.name} — Everest`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product');
    } finally {
      setLoading(false);
    }
  }

  async function handleReserve() {
    if (!product) return;
    try {
      setReserving(true);
      const reservation = await api.createReservation({
        sku: product.sku,
        quantity,
      });
      addToast('success', 'Reservation Created', `Reserved ${quantity} unit(s) of ${product.name}`);
      setShowReserveModal(false);
      navigate(`/reservations/${reservation.id}`);
    } catch (err) {
      addToast('error', 'Reservation Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setReserving(false);
    }
  }

  if (loading) {
    return (
      <div className="container page-content">
        <LoadingSpinner text="Loading product..." />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container page-content">
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <h2 className="empty-state-title">Product Not Found</h2>
          <p className="empty-state-description">{error || 'This product does not exist.'}</p>
          <Link to="/" className="btn btn-primary">
            Back to Products
          </Link>
        </div>
      </div>
    );
  }

  const stockLabel = getStockLabel(product.availableStock);
  const stockVariant = getStockBadgeVariant(product.availableStock, product.totalStock);
  const maxQuantity = Math.min(product.availableStock, 10);
  const canReserve = product.availableStock > 0;

  return (
    <div className="container page-content">
      <Link to="/" className="back-button">
        ← Back to Products
      </Link>

      <div className="product-detail">
        <div className="product-detail-hero">
          <div className="product-detail-icon">
            {getProductIcon(product.id)}
          </div>
          <h1 className="product-detail-name">{product.name}</h1>
          <div className="product-detail-sku">SKU: {product.sku}</div>
        </div>

        <div className="product-detail-body">
          <div className="product-detail-info">
            <Card>
              <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>About</h3>
              <p className="product-detail-description">
                {product.description || 'No description available for this product.'}
              </p>
            </Card>

            <Card>
              <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Stock Details</h3>
              <div className="product-detail-stats">
                <div className="product-stat">
                  <span className="product-stat-label">Status</span>
                  <Badge variant={stockVariant}>{stockLabel}</Badge>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Available</span>
                  <span className="product-stat-value">{product.availableStock}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Total Stock</span>
                  <span className="product-stat-value">{product.totalStock}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Reserved</span>
                  <span className="product-stat-value">{product.reservedCount}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Confirmed</span>
                  <span className="product-stat-value">{product.confirmedCount}</span>
                </div>
              </div>
            </Card>
          </div>

          <div>
            <Card gradient className="product-reserve-card">
              <h3 className="card-title">Reserve this Product</h3>
              <p className="text-secondary" style={{ fontSize: '0.875rem' }}>
                {canReserve
                  ? 'Secure your units now. Reservations are held for 10 minutes.'
                  : 'This product is currently out of stock.'}
              </p>
              <Button
                variant="primary"
                size="lg"
                disabled={!canReserve}
                onClick={() => {
                  setQuantity(1);
                  setShowReserveModal(true);
                }}
              >
                {canReserve ? '🔒 Reserve Now' : 'Out of Stock'}
              </Button>
            </Card>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showReserveModal}
        onClose={() => setShowReserveModal(false)}
        title="Reserve Product"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowReserveModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={reserving}
              onClick={handleReserve}
            >
              Confirm Reservation
            </Button>
          </>
        }
      >
        <div className="admin-form">
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
            <div className="product-card-icon" style={{ margin: '0 auto var(--space-3)', width: 56, height: 56, fontSize: '1.5rem', borderRadius: 'var(--radius-lg)' }}>
              {getProductIcon(product.id)}
            </div>
            <strong>{product.name}</strong>
            <div className="text-secondary" style={{ fontSize: '0.8125rem' }}>
              SKU: {product.sku}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Quantity</label>
            <div className="quantity-selector">
              <button
                className="quantity-btn"
                onClick={() => setQuantity((q) => clamp(q - 1, 1, maxQuantity))}
                disabled={quantity <= 1}
              >
                −
              </button>
              <span className="quantity-value">{quantity}</span>
              <button
                className="quantity-btn"
                onClick={() => setQuantity((q) => clamp(q + 1, 1, maxQuantity))}
                disabled={quantity >= maxQuantity}
              >
                +
              </button>
            </div>
            <span className="form-hint">
              {product.availableStock} unit{product.availableStock !== 1 ? 's' : ''} available (max {maxQuantity})
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
