import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import type { Reservation } from '../../lib/types';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { CountdownTimer } from '../../components/ui/CountdownTimer';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/Toast';

export function ReservationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadReservation();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadReservation() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getReservation(id!);
      setReservation(data);
      document.title = `Reservation — Everest`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reservation');
    } finally {
      setLoading(false);
    }
  }

  const handleExpire = useCallback(() => {
    setReservation((prev) =>
      prev ? { ...prev, status: 'expired' } : null,
    );
  }, []);

  async function handleConfirm() {
    if (!reservation || !paymentRef.trim()) return;
    try {
      setConfirming(true);
      const result = await api.confirmReservation(reservation.id, {
        paymentReference: paymentRef.trim(),
      });
      addToast('success', 'Reservation Confirmed!', 'Your order has been placed.');
      setShowConfirmModal(false);
      navigate(`/reservations/${reservation.id}/confirmed`, {
        state: { reservation: result, order: result.order },
      });
    } catch (err) {
      addToast('error', 'Confirmation Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    if (!reservation) return;
    try {
      setCancelling(true);
      const data = await api.cancelReservation(reservation.id);
      setReservation(data);
      addToast('info', 'Reservation Cancelled');
    } catch (err) {
      addToast('error', 'Cancellation Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="container page-content">
        <LoadingSpinner text="Loading reservation..." />
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="container page-content">
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <h2 className="empty-state-title">Reservation Not Found</h2>
          <p className="empty-state-description">{error || 'This reservation does not exist.'}</p>
          <Link to="/" className="btn btn-primary">
            Back to Products
          </Link>
        </div>
      </div>
    );
  }

  const isActive = reservation.status === 'reserved';
  const isConfirmed = reservation.status === 'confirmed';
  const isExpired = reservation.status === 'expired';
  const isCancelled = reservation.status === 'cancelled';

  const statusIcon = isActive ? '⏳' : isConfirmed ? '✅' : isExpired ? '⏰' : '❌';

  return (
    <div className="container page-content">
      <Link to="/" className="back-button">
        ← Back to Products
      </Link>

      <div className="reservation-detail">
        <Card className="reservation-status-card">
          <div className={`reservation-status-icon ${reservation.status}`}>
            {statusIcon}
          </div>

          <StatusBadge status={reservation.status} />

          <h2 style={{ marginTop: 'var(--space-4)', fontSize: '1.5rem', fontWeight: 700 }}>
            {isActive && 'Reservation Active'}
            {isConfirmed && 'Order Confirmed'}
            {isExpired && 'Reservation Expired'}
            {isCancelled && 'Reservation Cancelled'}
          </h2>

          {isActive && (
            <div style={{ marginTop: 'var(--space-6)' }}>
              <CountdownTimer
                expiresAt={reservation.expiresAt}
                onExpire={handleExpire}
              />
            </div>
          )}
        </Card>

        <Card>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            Reservation Details
          </h3>
          <div className="reservation-info-grid">
            <div className="reservation-info-item">
              <span className="reservation-info-label">Product</span>
              <span className="reservation-info-value">{reservation.productName}</span>
            </div>
            <div className="reservation-info-item">
              <span className="reservation-info-label">SKU</span>
              <span className="reservation-info-value" style={{ fontFamily: 'var(--font-mono)' }}>
                {reservation.sku}
              </span>
            </div>
            <div className="reservation-info-item">
              <span className="reservation-info-label">Quantity</span>
              <span className="reservation-info-value">{reservation.quantity}</span>
            </div>
            <div className="reservation-info-item">
              <span className="reservation-info-label">Created</span>
              <span className="reservation-info-value" style={{ fontSize: '0.8125rem' }}>
                {formatDate(reservation.createdAt)}
              </span>
            </div>
            <div className="reservation-info-item">
              <span className="reservation-info-label">Reservation ID</span>
              <span
                className="reservation-info-value"
                style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}
              >
                {reservation.id}
              </span>
            </div>
            <div className="reservation-info-item">
              <span className="reservation-info-label">Expires At</span>
              <span className="reservation-info-value" style={{ fontSize: '0.8125rem' }}>
                {formatDate(reservation.expiresAt)}
              </span>
            </div>
          </div>

          {isActive && (
            <div className="reservation-actions">
              <Button
                variant="success"
                size="lg"
                onClick={() => setShowConfirmModal(true)}
              >
                ✓ Confirm & Pay
              </Button>
              <Button
                variant="danger"
                size="lg"
                loading={cancelling}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </div>
          )}

          {(isExpired || isCancelled) && (
            <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
              <Link to="/" className="btn btn-primary btn-lg">
                Browse Products
              </Link>
            </div>
          )}
        </Card>
      </div>

      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Confirm Reservation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              loading={confirming}
              disabled={!paymentRef.trim()}
              onClick={handleConfirm}
            >
              Confirm Order
            </Button>
          </>
        }
      >
        <div className="admin-form">
          <p className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: 'var(--space-2)' }}>
            Enter your payment reference to confirm this reservation and place your order.
          </p>
          <div className="form-field">
            <label className="form-label" htmlFor="paymentRef">
              Payment Reference
            </label>
            <input
              id="paymentRef"
              type="text"
              placeholder="e.g., TXN-12345, INV-2024-001"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              autoFocus
            />
            <span className="form-hint">
              This could be a transaction ID, invoice number, or payment confirmation code.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
