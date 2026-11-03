import React from 'react';

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
  valueColor = 'text-blue-600',
  badge
}) => {
  return (
    <div className="bg-white border border-slate-200/90 shadow-sm p-3 sm:p-4 rounded-xl flex flex-col justify-between min-h-[95px] sm:min-h-[110px] transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider truncate">
          {title}
        </span>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </div>
      
      <div className="mt-auto">
        <div className={`text-xl sm:text-2xl lg:text-3xl font-mono font-black tabular-nums tracking-tight leading-none ${valueColor}`}>
          {value}
        </div>
        {subtitle && (
          <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-1 truncate">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
