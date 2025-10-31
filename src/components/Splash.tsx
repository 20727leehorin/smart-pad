// src/components/Splash.tsx
import React from "react";

export default function Splash({ onEnter }: { onEnter: () => void }) {
  return (
    <div
      className="fixed inset-0 w-full h-full bg-gradient-to-br from-sky-200 via-sky-300 to-sky-400
                 flex items-center justify-center select-none"
    >
      {/* 흰색 발바닥 로고만 클릭 가능 */}
      <button
        onClick={onEnter}
        aria-label="Enter app"
        className="transform transition-transform duration-300 hover:scale-110 focus:scale-110
                   active:scale-95 focus:outline-none"
      >
        <svg
          className="w-28 h-28 md:w-36 md:h-36 drop-shadow-xl"
          viewBox="0 0 128 128"
          fill="white"
          role="img"
          aria-hidden="true"
        >
          {/* 큰 패드 */}
          <path d="M78 78c9 9 5 23-7 26-12 3-24-8-21-20 2-9 19-16 28-6z" />
          {/* 작은 패드 3개 */}
          <circle cx="40" cy="40" r="10" />
          <circle cx="62" cy="32" r="9" />
          <circle cx="84" cy="42" r="8" />
        </svg>
      </button>
    </div>
  );
}
