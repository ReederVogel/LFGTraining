'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setIsVisible(false);
    const timer = setTimeout(() => {
      setDisplayChildren(children);
      setIsVisible(true);
    }, 150); // Half of transition duration for smooth crossfade

    return () => clearTimeout(timer);
  }, [pathname, children]);

  return (
    <div
      className={`page-transition ${isVisible ? 'page-visible' : 'page-hidden'}`}
    >
      {displayChildren}
    </div>
  );
}

