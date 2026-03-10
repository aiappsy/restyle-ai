import React, { useEffect, useState } from 'react';
import { getSavedDesigns } from '../services/ai';
import { Download, ChevronLeft, Image as ImageIcon, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SavedDesign {
  id: number;
  original_image: string;
  generated_image: string;
  style: string;
  room_type: string;
  created_at: string;
}

export default function MyDesigns() {
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const handleEdit = (design: SavedDesign) => {
    navigate('/', { state: { designToEdit: design } });
  };

  useEffect(() => {
    loadDesigns();
  }, []);

  const loadDesigns = async () => {
    try {
      setLoading(true);
      const data = await getSavedDesigns();
      setDesigns(data.designs || []);
    } catch (e) {
      console.error("Failed to load designs", e);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (imageUrl: string, style: string) => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `restyle-${style.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <a href="/" className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 font-medium transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Studio
          </a>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
            <ImageIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">My Designs</h1>
            <p className="text-gray-500 mt-1">A collection of all your saved architectural renders.</p>
          </div>
        </div>

        {designs.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500 shadow-sm mt-8">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-medium text-gray-900 mb-2">No designs saved yet</h3>
            <p className="mb-6">When you generate a design you love, click "Save Design" to keep it here forever.</p>
            <a href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
              Create a Design
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {designs.map(design => (
              <div key={design.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                <div className="aspect-[4/3] relative overflow-hidden bg-gray-100 border-b border-gray-200">
                  <img src={design.generated_image} alt={design.style} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="mb-4">
                    <h3 className="font-bold text-gray-900 text-lg mb-1">{design.style}</h3>
                    <p className="text-sm font-medium text-gray-500">{design.room_type} • {new Date(design.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="mt-auto flex flex-col gap-2">
                    <button 
                      onClick={() => handleEdit(design)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                    >
                      <Wand2 className="w-4 h-4" /> Open in Studio
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => handleExport(design.generated_image, design.style)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl transition-colors border border-gray-200"
                      >
                        <Download className="w-4 h-4" /> HD Export
                      </button>
                      <a 
                        href={design.generated_image} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl transition-colors border border-gray-200"
                      >
                        View Full
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
