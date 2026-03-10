import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  shops: string[];
  onAddShop: (shop: string) => void;
  onRemoveShop: (shop: string) => void;
}

export default function AdminModal({ isOpen, onClose, shops, onAddShop, onRemoveShop }: AdminModalProps) {
  const [input, setInput] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !shops.includes(input.trim())) {
      onAddShop(input.trim());
      setInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
          <h2 className="text-lg font-semibold text-gray-900">Admin: Configure Shops</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g., ikea.com or target.com"
              className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </form>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {shops.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No custom shops configured.</p>
            ) : (
              shops.map(shop => (
                <div key={shop} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-sm font-medium text-gray-700">{shop}</span>
                  <button
                    onClick={() => onRemoveShop(shop)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
