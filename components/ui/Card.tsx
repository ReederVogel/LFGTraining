import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ 
  children, 
  className = '', 
  onClick,
}: CardProps) {
  const baseStyles = 'bg-white border border-gray-200 rounded-lg overflow-hidden transition-shadow';
  const clickableStyles = onClick ? 'group cursor-pointer hover:shadow-xl hover:shadow-slate-950/60' : '';

  return (
    <div
      className={`${baseStyles} ${clickableStyles} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      {children}
    </div>
  );
}

