export const APP_NAME = 'Everest';
export const APP_DESCRIPTION = 'Inventory Reservation System';

export const RESERVATION_EXPIRY_WARNING_SECONDS = 120; // 2 minutes
export const RESERVATION_EXPIRY_CRITICAL_SECONDS = 30;

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const TOAST_DEFAULT_DURATION = 4000;

export const STATUS_LABELS: Record<string, string> = {
  reserved: 'Reserved',
  confirmed: 'Confirmed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  active: 'Active',
  inactive: 'Inactive',
  completed: 'Completed',
};

export const STATUS_VARIANTS: Record<string, string> = {
  reserved: 'info',
  confirmed: 'success',
  expired: 'warning',
  cancelled: 'error',
  active: 'success',
  inactive: 'neutral',
  completed: 'success',
};

export const PRODUCT_ICONS = [
  '📦', '🎁', '🏷️', '💎', '⚡', '🔮', '🎯', '🛡️',
  '🎨', '🔧', '💡', '🌟', '🚀', '🎲', '🧩', '🔑',
];

export const getProductIcon = (id: string): string => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PRODUCT_ICONS[hash % PRODUCT_ICONS.length];
};
