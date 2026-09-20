import React from 'react';

interface AcuityLogoProps {
  size?: number;
  className?: string;
}

export const AcuityLogo: React.FC<AcuityLogoProps> = ({ size = 22, className = '' }) => {
  return (
    <div
      style={{ width: size, height: size }}
      className={`relative rounded-[22%] bg-gradient-to-br from-[#2a2d37] to-[#121318] border border-white/15 flex items-center justify-center select-none shadow-xs shrink-0 overflow-hidden ${className}`}
    >
      <span
        style={{
          fontSize: size * 0.76,
          lineHeight: 1,
          fontFamily: "'Playfair Display', 'Cormorant Garamond', 'Georgia', serif",
        }}
        className="font-semibold italic text-neutral-100 transform -translate-y-[6%] select-none tracking-tighter"
      >
        a
      </span>
    </div>
  );
};
