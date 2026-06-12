interface CardProps {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

export function Card({
  children,
  className = '',
  gradient = false,
  interactive = false,
  onClick,
}: CardProps) {
  const classes = [
    'card',
    gradient ? 'card-gradient' : '',
    interactive ? 'card-interactive' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="card-header">
      <div>
        <h3 className="card-title">{title}</h3>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
