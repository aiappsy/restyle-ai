import React, { useState, useRef } from 'react';
import { ChevronsLeftRight, Maximize2 } from 'lucide-react';

interface CompareSliderProps {
  originalImage: string;
  generatedImage: string;
  onExpand?: () => void;
  hotspots?: { id: number, x: number, y: number, name: string }[];
  onHotspotClick?: (id: number) => void;
}

export default function CompareSlider({ originalImage, generatedImage, onExpand, hotspots, onHotspotClick }: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    // Only move if mouse is down (for mouse events)
    if (e.type === 'mousemove' && (e as React.MouseEvent).buttons !== 1) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    let clientX = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  };

  const handleDown = (e: React.MouseEvent | React.TouchEvent) => {
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    setMouseDownPos({ x: clientX, y: clientY });
  };

  const handleUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!onExpand) return;
    let clientX = 0;
    let clientY = 0;
    if ('changedTouches' in e) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    
    const dx = clientX - mouseDownPos.x;
    const dy = clientY - mouseDownPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If distance is small, it's a click, not a drag
    if (distance < 5) {
      onExpand();
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-[4/3] md:aspect-video overflow-hidden rounded-2xl select-none cursor-ew-resize bg-gray-100 shadow-lg group"
      onMouseMove={handleMove}
      onTouchMove={handleMove}
      onMouseDown={handleDown}
      onMouseUp={handleUp}
      onTouchStart={handleDown}
      onTouchEnd={handleUp}
    >
      <img 
        src={originalImage} 
        alt="Original Room" 
        className="absolute inset-0 w-full h-full object-cover pointer-events-none" 
      />
      <div
        className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img 
          src={generatedImage} 
          alt="Generated Room Design" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        {hotspots?.map((hotspot, idx) => (
          <div
            key={idx}
            className="absolute z-30 pointer-events-auto group/hotspot transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
            onClick={(e) => {
              e.stopPropagation();
              onHotspotClick?.(hotspot.id);
            }}
          >
            <div className="w-8 h-8 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.7)] border-2 border-indigo-500 animate-[pulse_2s_ease-in-out_infinite] transition-all hover:scale-125">
               <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />
            </div>
            <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-gray-900/95 backdrop-blur-sm text-white text-xs font-bold py-2 px-3 rounded-lg opacity-0 group-hover/hotspot:opacity-100 transition-opacity whitespace-nowrap shadow-xl pointer-events-none border border-gray-700">
              View {hotspot.name}
            </div>
          </div>
        ))}
      </div>
      <div 
        className="absolute top-0 bottom-0 w-1 bg-white/80 pointer-events-none" 
        style={{ left: `${position}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center">
          <ChevronsLeftRight className="w-5 h-5 text-gray-800" />
        </div>
      </div>
      
      <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm pointer-events-none z-10">
        AI Design
      </div>
      <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm pointer-events-none z-10">
        Original
      </div>

      {onExpand && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="absolute bottom-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-sm z-20 transition-colors opacity-0 group-hover:opacity-100"
          title="View Fullscreen"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
