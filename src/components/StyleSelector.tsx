import React from 'react';
import { Check } from 'lucide-react';

export const STYLES = [
  { id: 'mid-century', name: 'Mid-Century Modern', image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&q=80&w=200&h=200' },
  { id: 'scandinavian', name: 'Scandinavian', image: 'https://images.unsplash.com/photo-1550581190-9c1c48d21d6c?auto=format&fit=crop&q=80&w=200&h=200' },
  { id: 'industrial', name: 'Industrial', image: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&q=80&w=200&h=200' },
  { id: 'bohemian', name: 'Bohemian', image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&q=80&w=200&h=200' },
  { id: 'minimalist', name: 'Minimalist', image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&q=80&w=200&h=200' },
  { id: 'coastal', name: 'Coastal', image: 'https://images.unsplash.com/photo-1499933374294-4584851497cc?auto=format&fit=crop&q=80&w=200&h=200' },
];

interface StyleSelectorProps {
  selectedStyle: string;
  onSelectStyle: (style: string) => void;
}

export default function StyleSelector({ selectedStyle, onSelectStyle }: StyleSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {STYLES.map((style) => (
        <button
          key={style.id}
          onClick={() => onSelectStyle(style.name)}
          className={`relative group overflow-hidden rounded-xl aspect-[4/3] transition-all ${
            selectedStyle === style.name ? 'ring-2 ring-indigo-600 ring-offset-2' : 'hover:opacity-90'
          }`}
        >
          <img 
            src={style.image} 
            alt={style.name} 
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-left">
            <span className="text-white font-medium text-xs leading-tight block">{style.name}</span>
          </div>
          {selectedStyle === style.name && (
            <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center shadow-sm">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
