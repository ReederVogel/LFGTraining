import React, { useMemo } from 'react';
import Link from 'next/link';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  href?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export default React.memo(function Button({
  variant = 'primary',
  href,
  children,
  className = '',
  size = 'md',
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed rounded-full';
  
  const sizeStyles = {
    sm: 'px-4 py-2 text-xs sm:text-sm gap-2',
    md: 'px-6 py-2.5 text-sm sm:text-base gap-2',
    lg: 'px-8 py-3 text-base sm:text-lg gap-2',
  };
  
  const variantStyles = {
    primary: 'bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-indigo-500 shadow-lg shadow-blue-500/40',
    secondary: 'border border-white/20 bg-white/10 text-slate-100 hover:bg-white/15',
  };

  const combinedClassName = useMemo(
    () => `${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`,
    [size, variant, className]
  );

  if (href) {
    return (
      <Link href={href} className={combinedClassName} prefetch={true}>
        {children}
      </Link>
    );
  }

  return (
    <button className={combinedClassName} {...props}>
      {children}
    </button>
  );
});

