import type { BadgeVariant } from './types';

/**
 * Format a date string to a readable format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Format a date to relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

/**
 * Calculate remaining seconds until expiry
 */
export function getSecondsRemaining(expiresAt: string): number {
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((expiry - now) / 1000));
}

/**
 * Format seconds as MM:SS
 */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Get stock level classification
 */
export function getStockLevel(available: number, total: number): 'high' | 'medium' | 'low' | 'none' {
  if (available === 0) return 'none';
  const ratio = available / total;
  if (ratio > 0.5) return 'high';
  if (ratio > 0.2) return 'medium';
  return 'low';
}

/**
 * Get badge variant for stock level
 */
export function getStockBadgeVariant(available: number, total: number): BadgeVariant {
  const level = getStockLevel(available, total);
  switch (level) {
    case 'high': return 'success';
    case 'medium': return 'warning';
    case 'low': return 'error';
    case 'none': return 'error';
  }
}

/**
 * Get stock label
 */
export function getStockLabel(available: number): string {
  if (available === 0) return 'Out of Stock';
  if (available <= 5) return 'Low Stock';
  return 'In Stock';
}

/**
 * Get status badge variant
 */
export function getStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'reserved': return 'info';
    case 'confirmed':
    case 'completed':
    case 'active':
      return 'success';
    case 'expired': return 'warning';
    case 'cancelled': return 'error';
    default: return 'neutral';
  }
}

/**
 * Generate idempotency key
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Truncate text to max length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '…';
}

/**
 * Pluralize a word based on count
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural || singular + 's');
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
