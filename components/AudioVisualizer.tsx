'use client';

import React, { useEffect, useState } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  color?: 'blue' | 'purple' | 'green' | 'red';
  barCount?: number;
}

export default function AudioVisualizer({ 
  isActive, 
  color = 'blue',
  barCount = 20 
}: AudioVisualizerProps) {
  const [bars, setBars] = useState<number[]>(Array(barCount).fill(0));

  useEffect(() => {
    if (!isActive) {
      setBars(Array(barCount).fill(0));
      return;
    }

    const interval = setInterval(() => {
      setBars(prev => prev.map(() => Math.random() * 100));
    }, 100);

    return () => clearInterval(interval);
  }, [isActive, barCount]);

  const colorClasses = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  };

  return (
    <div className="flex items-center justify-center gap-1 h-12 px-2">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-1 ${colorClasses[color]} rounded-full transition-all duration-100 ease-in-out`}
          style={{ 
            height: isActive ? `${Math.max(height, 10)}%` : '10%',
            opacity: isActive ? 1 : 0.3 
          }}
        />
      ))}
    </div>
  );
}

