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
    'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const sizeStyles = {
    sm: 'px-4 py-2 text-sm rounded-md gap-2',
    md: 'px-6 py-2.5 text-base rounded-lg gap-2',
    lg: 'px-8 py-3 text-lg rounded-lg gap-2',
  };
  
  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 border border-gray-300',
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

