import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Upload, Image as ImageIcon, Download, Printer, Wand2, RefreshCw, ChevronRight, ChevronLeft, ShoppingBag, CheckCircle2, ExternalLink, Settings, X, MapPin, MessageSquare, Send, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import CompareSlider from '../components/CompareSlider';
import StyleSelector, { STYLES } from '../components/StyleSelector';
import AdminModal from '../components/AdminModal';
import { generateRoomDesign, generateShoppingList, ProductItem, PlacedItem, sourceProductsForLayout, renderFinalLayout, sendChatMessage, regenerateWithProducts, generateSpeech, saveDesign, locateProductsInImage } from '../services/ai';
import { useAuth } from '../contexts/AuthContext';

const ROOM_TYPES = ['Living Room', 'Bedroom', 'Dining Room', 'Home Office', 'Bathroom', 'Kitchen'];

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isGeneratingDesign?: boolean;
}
const BUDGETS = [
  { id: 'low', label: '$ (Affordable)', value: 'affordable' },
  { id: 'medium', label: '$$ (Moderate)', value: 'moderate' },
  { id: 'high', label: '$$$ (Luxury)', value: 'luxury' },
];

export default function Home() {
  const routerLocation = useLocation();
  const [step, setStep] = useState(1);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalMimeType, setOriginalMimeType] = useState<string>('');
  const [roomType, setRoomType] = useState(ROOM_TYPES[0]);
  const [selectedStyle, setSelectedStyle] = useState<string>(STYLES[0].name);
  const [budget, setBudget] = useState(BUDGETS[1].value);
  
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [shoppingList, setShoppingList] = useState<ProductItem[]>([]);

  const [selectedProductsToRegenerate, setSelectedProductsToRegenerate] = useState<number[]>([]);
  const [loadingState, setLoadingState] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin & Sourcing State
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [savedShops, setSavedShops] = useState<string[]>(() => {
    const saved = localStorage.getItem('restyle_admin_shops');
    return saved ? JSON.parse(saved) : ['ikea.com', 'westelm.com', 'wayfair.com'];
  });
  const [searchMode, setSearchMode] = useState<'auto' | 'manual'>('auto');
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  
  // Location & Shopping Method
  const [location, setLocation] = useState('');
  const [shoppingMethod, setShoppingMethod] = useState<'online' | 'in-store' | 'both'>('online');
  const [isLocating, setIsLocating] = useState(false);
  
  // Two-Step Generation State
  const [isSourcingProducts, setIsSourcingProducts] = useState(false);
  const [hasSourcedProducts, setHasSourcedProducts] = useState(false);
  const [isRegeneratingWithProducts, setIsRegeneratingWithProducts] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'shop'>('shop');
  const [activeProductId, setActiveProductId] = useState<number | null>(null);

  // Multi-Agent State
  const [agentProgress, setAgentProgress] = useState<{message: string} | null>(null);

  // New Interactive Layout State
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sourcedOptions, setSourcedOptions] = useState<Record<string, ProductItem[]>>({});
  const [selectedProductsMap, setSelectedProductsMap] = useState<Record<string, ProductItem>>({});

  // Chat State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const { user, logout } = useAuth();
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Initialize Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        
        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setChatInput(transcript);
          handleSendMessage(transcript);
        };
        
        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          setIsListening(false);
        };
        
        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
        // Stop any current speech when starting to listen
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
          setIsSpeaking(false);
        }
      } catch (e) {
        console.error("Failed to start listening", e);
      }
    }
  };

  const speakText = async (text: string) => {
    if (!voiceEnabled) return;
    
    // Stop any currently playing audio
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setIsSpeaking(true);
    try {
      const base64Audio = await generateSpeech(text);
      if (!base64Audio) {
        setIsSpeaking(false);
        return;
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      
      const pcm16 = new Int16Array(bytes.buffer);
      const audioBuffer = audioContext.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
          channelData[i] = pcm16[i] / 32768.0;
      }
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => setIsSpeaking(false);
      source.start();
    } catch (e) {
      console.error("Failed to play speech", e);
      setIsSpeaking(false);
    }
  };

  const toggleVoice = () => {
    if (voiceEnabled && audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      setIsSpeaking(false);
    }
    setVoiceEnabled(!voiceEnabled);
  };

  // Modal State
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('restyle_admin_shops', JSON.stringify(savedShops));
  }, [savedShops]);



  useEffect(() => {
    if (routerLocation.state?.designToEdit) {
      const design = routerLocation.state.designToEdit;
      
      const loadDesignToStudio = async () => {
        setLoadingState('Opening saved design...');
        setStep(3);
        try {
          const toBase64 = async (url: string) => {
            const res = await fetch(url);
            const blob = await res.blob();
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          };

          const origB64 = await toBase64(design.original_image);
          const genB64 = await toBase64(design.generated_image);

          setOriginalImage(origB64);
          setGeneratedImage(genB64);
          setOriginalMimeType('image/png');
          setRoomType(design.room_type);
          setSelectedStyle(design.style);
          setHasSourcedProducts(false);
          setShoppingList([]);
          setChatHistory([]);
          setStep(4);
        } catch (e) {
          console.error("Failed to load design", e);
          alert("Could not load design images.");
          setStep(1);
        } finally {
          window.history.replaceState({}, document.title);
        }
      };
      
      loadDesignToStudio();
    }
  }, [routerLocation.state]);

  const handleAddShop = (shop: string) => setSavedShops(prev => [...prev, shop]);
  const handleRemoveShop = (shop: string) => {
    setSavedShops(prev => prev.filter(s => s !== shop));
    setSelectedShops(prev => prev.filter(s => s !== shop));
  };
  const toggleShopSelection = (shop: string) => {
    setSelectedShops(prev => 
      prev.includes(shop) ? prev.filter(s => s !== shop) : [...prev, shop]
    );
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          // Reverse geocoding using a free API or just use lat/lng
          const { latitude, longitude } = position.coords;
          // For simplicity, we'll just set the coordinates if we can't easily reverse geocode,
          // but let's try a free reverse geocoding API (Nominatim)
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await res.json();
          if (data && data.address) {
            const city = data.address.city || data.address.town || data.address.village || '';
            const state = data.address.state || '';
            setLocation(`${city}${city && state ? ', ' : ''}${state}`);
          } else {
            setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        } catch (error) {
          console.error("Error getting location name:", error);
          setLocation(`${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.error("Error getting location:", error);
        alert('Unable to retrieve your location');
        setIsLocating(false);
      }
    );
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setOriginalImage(event.target?.result as string);
      setOriginalMimeType(file.type);
      setGeneratedImage(null);
      setShoppingList([]);
      setHasSourcedProducts(false);
      setIsSourcingProducts(false);
      setChatHistory([]);
      setStep(2);
    };
    reader.readAsDataURL(file);
  };

  const handleContinueToLayout = () => {
    if (!originalImage) return;
    setStep(3); // Go to Layout Canvas
    setPlacedItems([]);
    setActiveCategory(null);
    setSourcedOptions({});
    setSelectedProductsMap({});
    setShoppingList([]);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeCategory || isSourcingProducts) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    const newItem: PlacedItem = {
      id: Math.random().toString(36).substr(2, 9),
      category: activeCategory,
      x,
      y
    };
    
    setPlacedItems(prev => [...prev, newItem]);
    setActiveCategory(null); // Reset after placing
  };

  const handleSourceProducts = async () => {
    if (placedItems.length === 0) {
      alert("Please place at least one item on the room layout first.");
      return;
    }
    
    setStep(4); // Go to Product Selection loading state
    setLoadingState('Sourcing real products for your layout...');
    setIsSourcingProducts(true);

    try {
      const customShopsList = searchMode === 'manual' && selectedShops.length > 0 ? selectedShops : undefined;
      const mimeType = originalMimeType || 'image/jpeg';
      
      const categorizedProducts = await sourceProductsForLayout(
        originalImage!,
        mimeType,
        selectedStyle,
        roomType,
        budget,
        placedItems,
        customShopsList,
        location
      );

      setSourcedOptions(categorizedProducts);
      setIsSourcingProducts(false);
      
      // Auto-select the first option for each placed item by default
      const defaultSelections: Record<string, ProductItem> = {};
      placedItems.forEach(item => {
        const options = categorizedProducts[item.category];
        if (options && options.length > 0) {
          defaultSelections[item.id] = options[0];
        }
      });
      setSelectedProductsMap(defaultSelections);

    } catch (error) {
      console.error("Sourcing failed:", error);
      alert("Failed to source products. Please try again.");
      setIsSourcingProducts(false);
      setStep(3);
    }
  };

  const handleRenderFinal = async () => {
    // Check if every placedItem has a selected product
    const allSelected = placedItems.every(item => selectedProductsMap[item.id]);
    if (!allSelected) {
      alert("Please select a product option for every placed item before rendering.");
      return;
    }

    setStep(5); // Go to Rendering state
    setLoadingState('Rendering final photorealistic design...');
    setGeneratedImage(null);

    // Prepare final products array with precise X/Y
    const finalSelectedProducts: ProductItem[] = placedItems.map(item => {
      const prod = selectedProductsMap[item.id];
      return {
        ...prod,
        coordinates: { x: Math.round(item.x), y: Math.round(item.y) }
      };
    });

    try {
      const mimeType = originalMimeType || 'image/jpeg';
      const resultImage = await renderFinalLayout(
        originalImage!,
        mimeType,
        selectedStyle,
        roomType,
        finalSelectedProducts
      );

      setGeneratedImage(resultImage);
      setShoppingList(finalSelectedProducts); // For the UI
      setHasSourcedProducts(true);

    } catch (error) {
      console.error("Render failed:", error);
      alert("Failed to render the final image. Please try again.");
      setStep(4); // Back to selection
    }
  };

  const getProxyUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;
    
    const newUserMsg: ChatMessage = { role: 'user', text };
    const currentHistory = [...chatHistory];
    setChatHistory(prev => [...prev, newUserMsg]);
    setChatInput('');
    setIsChatLoading(true);
    
    try {
      const apiHistory = currentHistory.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));
      
      const imageToUse = generatedImage || originalImage!;
      const mimeTypeToUse = generatedImage ? 'image/png' : originalMimeType;

      const response = await sendChatMessage(apiHistory, text, selectedStyle, roomType, imageToUse, mimeTypeToUse);
      
      if (response.functionCalls && response.functionCalls.length > 0) {
        const call = response.functionCalls[0];
        if (call.name === 'updateDesign') {
          const args = call.args as any;
          const newInstructions = args.newInstructions;
          
          const updateMsg = `Updating design: ${newInstructions}`;
          setChatHistory(prev => [...prev, { role: 'model', text: updateMsg, isGeneratingDesign: true }]);
          speakText("I'm updating the design now. This will just take a moment.");
          
          try {
             // We MUST pass the *original* raw image to the image generator here!
             // If we pass the already generated image without an edit mask, the model refuses to alter existing AI furniture significantly.
             const newImage = await generateRoomDesign(originalImage!, originalMimeType, selectedStyle, roomType, newInstructions);
             setGeneratedImage(newImage);
             
             // Keep the description prompt in the chat log, and just turn off the loading spinner.
             setChatHistory(prev => prev.map(msg => msg.isGeneratingDesign ? { ...msg, isGeneratingDesign: false } : msg));
             
             const successMsg = "I've updated the design! How does it look now?";
             setChatHistory(prev => [...prev, { role: 'model', text: successMsg }]);
             speakText(successMsg);
          } catch (e) {
             const errorMsg = "Sorry, I encountered an error while updating the design.";
             setChatHistory(prev => prev.map(msg => msg.isGeneratingDesign ? { ...msg, isGeneratingDesign: false, text: errorMsg } : msg));
             speakText(errorMsg);
          }
        }
      } else {
        const replyText = response.text || '';
        setChatHistory(prev => [...prev, { role: 'model', text: replyText }]);
        speakText(replyText);
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorMsg = "Sorry, I'm having trouble connecting right now.";
      setChatHistory(prev => [...prev, { role: 'model', text: errorMsg }]);
      speakText(errorMsg);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleExport = () => {
    if (!generatedImage) return;
    const a = document.createElement('a');
    a.href = generatedImage;
    a.download = `restyle-${selectedStyle.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
  };

  const handleSaveDesign = async () => {
    if (!originalImage || !generatedImage) return;
    setIsSaving(true);
    try {
      await saveDesign(originalImage, generatedImage, selectedStyle, roomType);
      alert('Design saved successfully! You can view it in My Designs.');
    } catch (error) {
      console.error('Failed to save design', error);
      alert('Failed to save design. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const renderStepIndicator = () => {
    const steps = ['Upload', 'Customize', 'Review Design', 'Shop'];
    
    let currentVisualStep = 1;
    if (step === 1) currentVisualStep = 1;
    if (step === 2) currentVisualStep = 2;
    if (step === 3) currentVisualStep = 3;
    if (step === 4) {
      if (!hasSourcedProducts && !isSourcingProducts) currentVisualStep = 3;
      else currentVisualStep = 4;
    }

    return (
      <div className="w-full py-6 mb-8 border-b border-gray-200">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4">
          {steps.map((s, i) => {
            const stepNum = i + 1;
            const isActive = currentVisualStep === stepNum;
            const isPast = currentVisualStep > stepNum;
            return (
              <div key={s} className="flex flex-col items-center relative z-10 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                  isActive ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' :
                  isPast ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  {isPast ? <CheckCircle2 className="w-5 h-5" /> : stepNum}
                </div>
                <span className={`mt-2 text-xs font-medium ${isActive ? 'text-indigo-900' : isPast ? 'text-indigo-600' : 'text-gray-400'}`}>
                  {s}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setStep(1)}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">ReStyle AI</h1>
          </div>
          
          <div className="flex items-center gap-4">
            {user && (
              <div className="hidden md:flex items-center gap-4">
                <div className="px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-lg text-sm font-semibold text-indigo-700 shadow-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                  {user.credits} Credits Left
                </div>
                {user.role === 'admin' && (
                  <a href="/admin" className="text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors">Admin Dashboard</a>
                )}
                <a href="/my-designs" className="text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors">My Designs</a>
                <div className="h-4 w-px bg-gray-200"></div>
                <div className="text-sm">
                  <span className="text-gray-500 block leading-tight">Signed in as</span>
                  <span className="font-medium text-gray-900 leading-tight block">{user.name}</span>
                </div>
                <button
                  onClick={() => {
                    logout();
                    window.location.reload();
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
                >
                  Log Out
                </button>
              </div>
            )}
            {step === 4 && (
              <div className="flex items-center gap-1 sm:gap-3 ml-2 pl-2 sm:ml-4 sm:pl-4 border-l border-gray-200">
                <button 
                  onClick={handlePrint}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Print Design"
                >
                  <Printer className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleExport}
                  className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Export</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {renderStepIndicator()}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        
        {/* STEP 1: UPLOAD */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-bold tracking-tight">Transform your space in seconds</h2>
            <p className="text-gray-500 text-lg">Upload a photo of your room, choose a style, and we'll redesign it and find the exact furniture for you to buy.</p>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="mt-8 w-full aspect-video border-2 border-dashed border-gray-300 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50/50 transition-all group bg-white shadow-sm"
            >
              <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Upload className="w-10 h-10" />
              </div>
              <p className="text-xl font-medium text-gray-700">Upload a photo of your room</p>
              <p className="text-gray-500 mt-2">Drag and drop or click to browse</p>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
        )}

        {/* STEP 2: CUSTOMIZE */}
        {step === 2 && originalImage && (
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold">Customize your redesign</h2>
                <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Change Photo
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-8">
                  {/* Room Type */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-3">What kind of room is this?</label>
                    <div className="grid grid-cols-2 gap-3">
                      {ROOM_TYPES.map(type => (
                        <button
                          key={type}
                          onClick={() => setRoomType(type)}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                            roomType === type 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Budget */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-3">What is your furniture budget?</label>
                    <div className="grid grid-cols-3 gap-3">
                      {BUDGETS.map(b => (
                        <button
                          key={b.id}
                          onClick={() => setBudget(b.value)}
                          className={`px-3 py-3 rounded-xl text-sm font-medium transition-all text-center ${
                            budget === b.value 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Style Selector */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">Choose a design style</label>
                  <StyleSelector 
                    selectedStyle={selectedStyle} 
                    onSelectStyle={setSelectedStyle} 
                  />
                </div>

                {/* Sourcing Preference */}
                <div className="md:col-span-2 pt-6 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    {/* Shopping Method */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-3">How do you want to shop?</label>
                      <div className="grid grid-cols-3 gap-3">
                        <button
                          onClick={() => setShoppingMethod('online')}
                          className={`px-3 py-3 rounded-xl text-sm font-medium transition-all text-center ${
                            shoppingMethod === 'online' 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          Online Only
                        </button>
                        <button
                          onClick={() => setShoppingMethod('in-store')}
                          className={`px-3 py-3 rounded-xl text-sm font-medium transition-all text-center ${
                            shoppingMethod === 'in-store' 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          In-Store Only
                        </button>
                        <button
                          onClick={() => setShoppingMethod('both')}
                          className={`px-3 py-3 rounded-xl text-sm font-medium transition-all text-center ${
                            shoppingMethod === 'both' 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          Both
                        </button>
                      </div>
                    </div>

                    {/* Location */}
                    <div className={shoppingMethod === 'online' ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
                      <label className="block text-sm font-semibold text-gray-900 mb-3">Your Location (for local stores)</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <MapPin className="h-4 w-4 text-gray-400" />
                          </div>
                          <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="City, State or Zip"
                            className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-all"
                          />
                        </div>
                        <button
                          onClick={handleGetLocation}
                          disabled={isLocating}
                          className="px-4 py-3 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                          {isLocating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                          <span className="hidden sm:inline">Locate Me</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-sm font-semibold text-gray-900">Product Sourcing</label>
                    <button onClick={() => setIsAdminOpen(true)} className="text-xs text-indigo-600 font-medium hover:text-indigo-800 flex items-center gap-1">
                      <Settings className="w-3.5 h-3.5" /> Configure Shops
                    </button>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-4 mb-4">
                    <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${searchMode === 'auto' ? 'border-indigo-600 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="searchMode" checked={searchMode === 'auto'} onChange={() => setSearchMode('auto')} className="w-4 h-4 text-indigo-600 focus:ring-indigo-500" />
                      <div>
                        <div className="font-medium text-sm text-gray-900">Auto Search</div>
                        <div className="text-xs text-gray-500">Search the entire web for the best matches</div>
                      </div>
                    </label>
                    <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${searchMode === 'manual' ? 'border-indigo-600 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="searchMode" checked={searchMode === 'manual'} onChange={() => setSearchMode('manual')} className="w-4 h-4 text-indigo-600 focus:ring-indigo-500" />
                      <div>
                        <div className="font-medium text-sm text-gray-900">Specific Shops</div>
                        <div className="text-xs text-gray-500">Only search within your preferred stores</div>
                      </div>
                    </label>
                  </div>

                  {searchMode === 'manual' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      {savedShops.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center">No shops configured. Click "Configure Shops" above to add some.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {savedShops.map(shop => (
                            <button
                              key={shop}
                              onClick={() => toggleShopSelection(shop)}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                                selectedShops.includes(shop)
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {shop}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-gray-100 flex justify-end">
                <button
                  onClick={handleContinueToLayout}
                  className="px-8 py-4 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transform"
                >
                  Continue to Layout Planner
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: INTERACTIVE LAYOUT PLANNER */}
        {step === 3 && originalImage && (
          <div className="animate-in fade-in duration-500 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Plan Your Layout</h2>
              <button 
                onClick={() => setStep(2)}
                className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> Back to Customization
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Toolbar */}
              <div className="lg:col-span-3 space-y-4">
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-4">1. Select an item</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {['Sofa', 'Accent Chair', 'Coffee Table', 'Rug', 'Table Lamp', 'Floor Lamp', 'Pendant Light', 'Wall Art', 'Plant', 'TV Stand', 'Bed', 'Nightstand', 'Dining Table', 'Dining Chair'].map(cat => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                        className={`text-xs p-2 rounded-lg border font-medium transition-all text-center ${
                          activeCategory === cat
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-white'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  
                  <div className="mt-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h3 className="font-semibold text-indigo-900 text-sm mb-2">2. Click image to place</h3>
                    <p className="text-xs text-indigo-700">Select an item above, then click anywhere on your room photo to mark where you want it to go.</p>
                  </div>

                  <div className="mt-6">
                     <h3 className="font-semibold text-gray-900 text-sm mb-3">Placed Items ({placedItems.length})</h3>
                     {placedItems.length === 0 ? (
                       <p className="text-xs text-gray-500 italic">No items placed yet.</p>
                     ) : (
                       <ul className="space-y-2 max-h-48 overflow-y-auto">
                         {placedItems.map(item => (
                           <li key={item.id} className="flex items-center justify-between text-xs p-2 bg-gray-50 rounded border border-gray-100">
                             <div className="flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                               <span className="font-medium text-gray-700">{item.category}</span>
                             </div>
                             <button
                               onClick={() => setPlacedItems(prev => prev.filter(p => p.id !== item.id))}
                               className="text-gray-400 hover:text-red-500"
                             >
                               <X className="w-3 h-3" />
                             </button>
                           </li>
                         ))}
                       </ul>
                     )}
                  </div>

                  <button
                    onClick={handleSourceProducts}
                    disabled={placedItems.length === 0}
                    className="w-full mt-6 px-4 py-3 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-md"
                  >
                    Find Real Products
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Canvas */}
              <div className="lg:col-span-9">
                <div 
                  className={`relative rounded-3xl overflow-hidden bg-gray-100 border-2 shadow-sm transition-all ${
                    activeCategory ? 'border-indigo-400 cursor-crosshair' : 'border-transparent'
                  }`}
                  onClick={handleCanvasClick}
                >
                  <img src={originalImage} alt="Room Layout" className="w-full h-auto object-contain block pointer-events-none select-none" />
                  
                  {/* Markers */}
                  {placedItems.map((item, idx) => (
                    <div 
                      key={item.id}
                      className="absolute w-6 h-6 -ml-3 -mt-3 bg-indigo-600 border-2 border-white text-white rounded-full shadow-lg flex items-center justify-center text-[10px] font-bold z-10 animate-in zoom-in pointer-events-none"
                      style={{ left: `${item.x}%`, top: `${item.y}%` }}
                    >
                      {idx + 1}
                    </div>
                  ))}

                  {activeCategory && (
                     <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
                       <span className="bg-gray-900/80 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm shadow-xl">
                         Click anywhere to place the {activeCategory}
                       </span>
                     </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: PRODUCT SELECTION & SOURCING */}
        {step === 4 && (
          <div className="animate-in fade-in duration-500 max-w-6xl mx-auto">
             {isSourcingProducts ? (
               <div className="text-center py-20">
                 <div className="relative w-32 h-32 mx-auto mb-8">
                   <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                   <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                   <div className="absolute inset-0 flex items-center justify-center">
                     <ShoppingBag className="w-10 h-10 text-indigo-600 animate-pulse" />
                   </div>
                 </div>
                 <h2 className="text-3xl font-bold tracking-tight mb-4">{loadingState}</h2>
                 <p className="text-gray-500 text-lg max-w-md mx-auto">
                   Our AI is searching the web to find the perfect real-world products matching your layout and {selectedStyle} style.
                 </p>
               </div>
             ) : (
               <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-2xl font-bold">Select Your Exact Products</h2>
                      <p className="text-gray-500 text-sm">Choose one specific product for each item you placed.</p>
                    </div>
                    <button
                      onClick={handleRenderFinal}
                      className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-md flex items-center gap-2"
                    >
                      <Wand2 className="w-5 h-5" />
                      Render Final Design
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left: Map Reference */}
                    <div className="lg:col-span-5 relative hidden lg:block">
                       <div className="sticky top-24 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
                         <div className="relative rounded-xl overflow-hidden">
                           <img src={originalImage!} alt="Map" className="w-full h-auto object-cover opacity-50" />
                           {placedItems.map((item, idx) => {
                             const isSelected = selectedProductsMap[item.id] !== undefined;
                             return (
                               <div 
                                 key={item.id}
                                 className={`absolute -ml-4 -mt-4 w-10 h-10 rounded-full border-2 shadow-xl flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                                   isSelected ? 'bg-indigo-600 border-white text-white scale-110' : 'glass border-gray-300 text-gray-700'
                                 }`}
                                 style={{ left: `${item.x}%`, top: `${item.y}%` }}
                               >
                                 {isSelected && selectedProductsMap[item.id].imageUrl ? (
                                   <div className="relative w-full h-full rounded-full overflow-hidden border border-white/50">
                                      <img src={getProxyUrl(selectedProductsMap[item.id].imageUrl)} className="w-full h-full object-cover" alt="" />
                                      <div className="absolute inset-0 bg-indigo-600/20"></div>
                                   </div>
                                 ) : (
                                   <div className="animate-pulse">{idx + 1}</div>
                                 )}
                               </div>
                             );
                           })}
                         </div>
                       </div>
                    </div>

                     {/* Right: Product Lists */}
                     <div className="lg:col-span-7 space-y-12 pb-32">
                        {placedItems.map((item, idx) => {
                          const options = sourcedOptions[item.category] || [];
                          const selectedProd = selectedProductsMap[item.id];
                          
                          return (
                            <div key={item.id} className="glass p-8 rounded-[2.5rem] relative animate-fade-in group" style={{ animationDelay: `${idx * 150}ms` }}>
                              <div className="absolute -top-6 left-8 flex items-center gap-4">
                                 <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-bold text-xl shadow-lg ring-8 ring-white/50 backdrop-blur-md transform transition-transform group-hover:rotate-12">
                                   {idx + 1}
                                 </div>
                                 <div className="bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-sm border border-white/20">
                                   <h3 className="font-bold text-slate-900 text-lg uppercase tracking-wider">Pick a {item.category}</h3>
                                 </div>
                              </div>
                              
                              {options.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 font-medium italic mt-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                                  Our agents are still hunting for the perfect {item.category}...
                                </div>
                              ) : (
                                <div className="flex gap-6 overflow-x-auto py-6 px-1 snap-x custom-scrollbar mt-4 mask-fade-edges">
                                  {options.map((prod, optIdx) => {
                                    const isActive = selectedProd?.name === prod.name;
                                    return (
                                      <div 
                                        key={optIdx}
                                        onClick={() => setSelectedProductsMap(prev => ({ ...prev, [item.id]: prod }))}
                                        className={`snap-center shrink-0 w-64 rounded-3xl border-2 p-4 cursor-pointer transition-all duration-300 premium-card ${
                                          isActive 
                                            ? 'border-indigo-500 bg-indigo-50/40 shadow-xl shadow-indigo-100 ring-4 ring-indigo-500/10 scale-[1.02]' 
                                            : 'border-white/50 bg-white/40 hover:bg-white/60'
                                        }`}
                                      >
                                         <div className="w-full aspect-square bg-white rounded-2xl mb-4 overflow-hidden shadow-inner group/img relative">
                                            <img 
                                              src={getProxyUrl(prod.imageUrl)} 
                                              alt={prod.name} 
                                              className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" 
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?q=80&w=300&auto=format&fit=crop';
                                              }}
                                            />
                                            {isActive && (
                                              <div className="absolute top-2 right-2 bg-indigo-600 text-white p-1.5 rounded-full shadow-lg">
                                                <CheckCircle2 className="w-4 h-4" />
                                              </div>
                                            )}
                                         </div>
                                         <div className="px-1">
                                           <h4 className="font-bold text-slate-800 text-base line-clamp-2 leading-tight mb-2 min-h-[2.5rem]">{prod.name}</h4>
                                           <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
                                             <span className="text-sm font-medium text-slate-500 truncate max-w-[60%]">{prod.vendor}</span>
                                             <span className="text-base font-black text-indigo-600">{prod.price}</span>
                                           </div>
                                         </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                     </div>

                    </div>
                  </div>
               )}
          </div>
        )}

        {/* STEP 5: RESULTS */}
        {step === 5 && generatedImage && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Your New {roomType}</h2>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleContinueToLayout}
                  className="px-4 py-2 bg-indigo-50 text-indigo-600 font-medium rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="hidden sm:inline">Retry Design</span>
                </button>
                <button 
                  onClick={() => setStep(2)}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Try Another Style
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left: Visualization */}
              <div className="lg:col-span-7">
                <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 sticky top-24">
                  <CompareSlider 
                    originalImage={originalImage!} 
                    generatedImage={generatedImage} 
                    onExpand={() => setIsImageModalOpen(true)}
                    hotspots={shoppingList
                      .map((p, i) => ({ ...p, id: i }))
                      .filter(p => p.coordinates)
                      .map(p => ({
                        id: p.id,
                        name: p.name,
                        x: p.coordinates!.x,
                        y: p.coordinates!.y
                      }))
                    }
                    onHotspotClick={(id) => {
                      setActiveTab('shop');
                      setActiveProductId(id);
                      document.getElementById(`product-card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setTimeout(() => setActiveProductId(null), 3000);
                    }}
                  />
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-gray-500">Click or drag to compare. Click image fullscreen.</p>
                    <div className="flex items-center gap-2">
                       <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-xl transition-colors">
                         <Download className="w-4 h-4" /> Download HD
                       </button>
                       <button 
                         onClick={handleSaveDesign} 
                         disabled={isSaving}
                         className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                       >
                         {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                         Save to Account
                       </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Shopping List or Chat TABS */}
              <div className="lg:col-span-5 h-[calc(100vh-20rem)] min-h-[500px]">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 h-full flex flex-col overflow-hidden">
                  {/* Tabs Header */}
                  <div className="flex border-b border-gray-100">
                    <button 
                      onClick={() => setActiveTab('shop')}
                      className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'shop' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <ShoppingBag className="w-4 h-4" />
                      Shopping List ({shoppingList.length})
                    </button>
                    <button 
                      onClick={() => setActiveTab('chat')}
                      className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'chat' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      Design Assistant
                    </button>
                  </div>

                  <div className="flex-1 overflow-hidden p-6">
                    {activeTab === 'chat' ? (
                      <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shrink-0">
                              <MessageSquare className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold">Design Assistant</h3>
                            </div>
                          </div>
                          <button 
                            onClick={toggleVoice}
                            className={`p-2 rounded-full transition-colors ${voiceEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}
                          >
                            {voiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                          </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto mb-4 bg-gray-50 rounded-2xl p-4 space-y-4 custom-scrollbar">
                          {chatHistory.length === 0 && (
                            <div className="text-center text-gray-500 my-8">
                              <p>Hi! I'm your AI design expert.</p>
                              <p className="text-sm mt-2">Want to change the sofa color? Just ask!</p>
                            </div>
                          )}
                          {chatHistory.map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                                msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
                              }`}>
                                {msg.isGeneratingDesign ? (
                                  <div className="flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                                    <span className="text-sm">{msg.text}</span>
                                  </div>
                                ) : (
                                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                                )}
                              </div>
                            </div>
                          ))}
                          {isChatLoading && (
                            <div className="flex justify-start">
                              <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                                <div className="flex gap-1">
                                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 relative mt-auto">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(chatInput)}
                            placeholder="E.g., Make the sofa navy blue..."
                            className="flex-1 border border-gray-200 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors"
                            disabled={isChatLoading}
                          />
                          <button
                            onClick={() => handleSendMessage(chatInput)}
                            disabled={!chatInput.trim() || isChatLoading}
                            className="bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0"
                          >
                            <Send className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col h-full animate-in fade-in duration-300">
                        <div className="flex items-center gap-3 mb-6">
                          <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                            <ShoppingBag className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold">Shop the Look</h3>
                            <p className="text-sm text-gray-500">Real products curated for this design</p>
                          </div>
                        </div>

                        {shoppingList.length === 0 ? (
                          <div className="text-center py-12 text-gray-500">
                            <p>We couldn't find specific products for this design.</p>
                            <button onClick={handleContinueToLayout} className="mt-4 text-indigo-600 font-medium hover:underline">Try generating again</button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4 mb-4">
                              {shoppingList.map((item, idx) => (
                                <div 
                                  key={idx} 
                                  id={`product-card-${idx}`}
                                  className={`group rounded-2xl p-4 transition-all flex gap-4 ${
                                    activeProductId === idx 
                                      ? 'border-2 border-indigo-500 bg-indigo-50/30 shadow-md ring-4 ring-indigo-500/20' 
                                      : 'border border-gray-100 hover:border-indigo-200 hover:shadow-md bg-gray-50/50 hover:bg-white'
                                  }`}
                                >
                                  {item.imageUrl && (
                                    <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                                      <img 
                                        src={item.imageUrl} 
                                        alt={item.name} 
                                        className="w-full h-full object-cover" 
                                        referrerPolicy="no-referrer" 
                                        onError={(e) => {
                                          const parent = e.currentTarget.parentElement;
                                          if (parent) parent.style.display = 'none';
                                        }}
                                      />
                                    </div>
                                  )}
                                  <div className="flex-1 flex justify-between items-start gap-4">
                                    <div>
                                      <span className="text-xs font-bold tracking-wider text-indigo-600 uppercase mb-1 block">{item.category}</span>
                                      <h4 className="font-semibold text-gray-900 leading-tight mb-1">{item.name}</h4>
                                      <p className="text-sm text-gray-500 mb-3">{item.vendor} • {item.price}</p>
                                    </div>
                                    <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-10 h-10 bg-gray-900 text-white rounded-full flex items-center justify-center hover:bg-indigo-600 transition-colors shadow-sm">
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      <AdminModal 
        isOpen={isAdminOpen} 
        onClose={() => setIsAdminOpen(false)} 
        shops={savedShops} 
        onAddShop={handleAddShop} 
        onRemoveShop={handleRemoveShop} 
      />

      {/* Image Modal */}
      {isImageModalOpen && generatedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200" 
          onClick={() => setIsImageModalOpen(false)}
        >
          <button 
            onClick={() => setIsImageModalOpen(false)} 
            className="absolute top-6 right-6 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img 
            src={generatedImage} 
            alt="Generated Design Fullscreen" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </div>
  );
}
