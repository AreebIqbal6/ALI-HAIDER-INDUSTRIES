import React from 'react';
import { Card } from './card';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: React.ReactNode;
  valueColor?: string;
  badge?: React.ReactNode;
}

export const KpiCard: React.FC<KpiCardProps> = ({ 
  title, 
  value, 
  subtitle, 
  valueColor = 'text-zinc-950',
  badge
}) => {
  return (
    <Card className="p-4 flex flex-col justify-between min-h-[100px] border-zinc-200 shadow-2xs">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider truncate">
          {title}
        </span>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </div>
      
      <div className="mt-auto">
        <div className={`text-2xl sm:text-3xl font-mono font-bold tabular-nums tracking-tight leading-none ${valueColor}`}>
          {value}
        </div>
        {subtitle && (
          <div className="text-xs text-zinc-500 mt-1 truncate">
            {subtitle}
          </div>
        )}
      </div>
    </Card>
  );
};
