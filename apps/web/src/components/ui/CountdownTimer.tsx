import { useState, useEffect, useCallback } from 'react';
import { getSecondsRemaining, formatCountdown } from '../../lib/utils';
import {
  RESERVATION_EXPIRY_WARNING_SECONDS,
  RESERVATION_EXPIRY_CRITICAL_SECONDS,
} from '../../lib/constants';

interface CountdownTimerProps {
  expiresAt: string;
  totalDurationSeconds?: number;
  onExpire?: () => void;
}

export function CountdownTimer({
  expiresAt,
  totalDurationSeconds = 600,
  onExpire,
}: CountdownTimerProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    getSecondsRemaining(expiresAt),
  );

  const getTimerClass = useCallback(() => {
    if (secondsRemaining <= 0) return 'expired';
    if (secondsRemaining <= RESERVATION_EXPIRY_CRITICAL_SECONDS) return 'critical';
    if (secondsRemaining <= RESERVATION_EXPIRY_WARNING_SECONDS) return 'warning';
    return '';
  }, [secondsRemaining]);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getSecondsRemaining(expiresAt);
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const progressPercent = Math.min(
    100,
    (secondsRemaining / totalDurationSeconds) * 100,
  );
  const timerClass = getTimerClass();
  const isExpired = secondsRemaining <= 0;

  return (
    <div className="countdown">
      <span className="countdown-label">
        {isExpired ? 'Reservation Expired' : 'Time Remaining'}
      </span>
      <span className={`countdown-display ${timerClass}`}>
        {isExpired ? '00:00' : formatCountdown(secondsRemaining)}
      </span>
      <div className="countdown-bar">
        <div
          className={`countdown-bar-fill ${timerClass}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
