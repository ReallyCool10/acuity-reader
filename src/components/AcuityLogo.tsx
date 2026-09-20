import React, { useId } from 'react';

interface AcuityLogoProps {
  size?: number;
  className?: string;
}

export const AcuityLogo: React.FC<AcuityLogoProps> = ({ size = 24, className = '' }) => {
  const rawId = useId();
  const gradId = `acuityGrad-${rawId.replace(/:/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none shrink-0 ${className}`}
      aria-label="Acuity Logo"
    >
      <defs>
        <linearGradient id={gradId} x1="10%" y1="10%" x2="90%" y2="90%">
          {/* Top Left: Light Orange Yellow */}
          <stop offset="0%" stopColor="#ffd8a8" />
          <stop offset="35%" stopColor="#fef08a" />
          {/* Bottom Right: Light Blue */}
          <stop offset="100%" stopColor="#93c5fd" />
        </linearGradient>
      </defs>
      <text
        x="48"
        y="83"
        fontFamily="'Playfair Display', 'Cormorant Garamond', 'Baskerville', 'Georgia', serif"
        fontSize="106"
        fontWeight="600"
        fontStyle="italic"
        textAnchor="middle"
        fill={`url(#${gradId})`}
        letterSpacing="-2"
      >
        a
      </text>
    </svg>
  );
};
