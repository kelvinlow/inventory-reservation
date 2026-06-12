interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  const sizeClass = size === 'sm' ? 'loading-spinner-sm' : size === 'lg' ? 'loading-spinner-lg' : '';

  return (
    <div className="loading-spinner-wrapper">
      <div className={`loading-spinner ${sizeClass}`} />
      {text && <p className="loading-spinner-text">{text}</p>}
    </div>
  );
}
