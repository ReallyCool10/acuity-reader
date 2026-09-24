import React, { useId } from 'react';
import {
  ACUITY_LOGO_VIEWBOX,
  ACUITY_LOGO_BASE_GRADIENT,
  ACUITY_LOGO_TOP_GRADIENT,
  ACUITY_LOGO_PATH,
} from './acuityLogoConstants';

interface AcuityLogoProps {
  size?: number;
  className?: string;
}

export const AcuityLogo: React.FC<AcuityLogoProps> = ({ size = 24, className = '' }) => {
  const rawId = useId();
  const cleanId = rawId.replace(/:/g, '');
  const baseGradId = `acuityGradBase-${cleanId}`;
  const topGradId = `acuityGradTop-${cleanId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={ACUITY_LOGO_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none shrink-0 ${className}`}
      aria-label="Acuity Logo"
    >
      <defs>
        <linearGradient
          id={baseGradId}
          x1={ACUITY_LOGO_BASE_GRADIENT.x1}
          y1={ACUITY_LOGO_BASE_GRADIENT.y1}
          x2={ACUITY_LOGO_BASE_GRADIENT.x2}
          y2={ACUITY_LOGO_BASE_GRADIENT.y2}
        >
          {ACUITY_LOGO_BASE_GRADIENT.stops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
        <linearGradient
          id={topGradId}
          x1={ACUITY_LOGO_TOP_GRADIENT.x1}
          y1={ACUITY_LOGO_TOP_GRADIENT.y1}
          x2={ACUITY_LOGO_TOP_GRADIENT.x2}
          y2={ACUITY_LOGO_TOP_GRADIENT.y2}
        >
          {ACUITY_LOGO_TOP_GRADIENT.stops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
              stopOpacity={stop.opacity ?? 1}
            />
          ))}
        </linearGradient>
      </defs>
      <path d={ACUITY_LOGO_PATH} fill={`url(#${baseGradId})`} />
      <path d={ACUITY_LOGO_PATH} fill={`url(#${topGradId})`} />
    </svg>
  );
};
