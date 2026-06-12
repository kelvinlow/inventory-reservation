import { Badge } from './Badge';
import { getStatusVariant } from '../../lib/utils';
import { STATUS_LABELS } from '../../lib/constants';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = getStatusVariant(status);
  const label = STATUS_LABELS[status] || status;

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
