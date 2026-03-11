export interface ProductItem {
  name: string;
  price: string;
  vendor: string;
  productUrl: string;
  imageUrl: string;
  category: string;
  reason: string;
  visualDescription: string;
  coordinates?: { x: number, y: number };
}

const getHeaders = () => {
  const token = localStorage.getItem('restyle_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

const handleResponse = async (response: Response) => {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'API request failed');
  }
  return response.json();
};

export async function generateRoomDesign(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  additionalInstructions?: string
): Promise<string> {
  const response = await fetch('/api/generate-design', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ base64Image, mimeType, style, roomType, additionalInstructions })
  });
  const data = await handleResponse(response);
  return data.result;
}

export async function sendChatMessage(
  history: { role: string, parts: { text: string }[] }[],
  message: string,
  style: string,
  roomType: string,
  base64Image?: string,
  mimeType?: string
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ history, message, style, roomType, base64Image, mimeType })
  });
  return handleResponse(response);
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.audio;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

export async function generateShoppingList(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  budget: string,
  customShops?: string[],
  location?: string,
  shoppingMethod?: 'online' | 'in-store' | 'both'
): Promise<ProductItem[]> {
  try {
    const response = await fetch('/api/shopping-list', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ base64Image, mimeType, style, roomType, budget, customShops, location, shoppingMethod })
    });
    const data = await handleResponse(response);
    return data.products || [];
  } catch (e) {
    console.error("Failed to generate shopping list", e);
    return [];
  }
}

export async function regenerateWithProducts(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  products: ProductItem[]
): Promise<string> {
  const response = await fetch('/api/regenerate-products', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ base64Image, mimeType, style, roomType, products })
  });
  const data = await handleResponse(response);
  return data.result;
}

export async function saveDesign(originalBase64: string, generatedBase64: string, style: string, roomType: string) {
  const response = await fetch('/api/designs/save', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ originalBase64, generatedBase64, style, roomType })
  });
  return handleResponse(response);
}

export async function getSavedDesigns() {
  const response = await fetch('/api/designs', {
    method: 'GET',
    headers: getHeaders()
  });
  return handleResponse(response);
}

export async function locateProductsInImage(
  base64Image: string,
  mimeType: string,
  products: (ProductItem & { id?: number })[]
): Promise<{ coordinates: { productId: number; x: number; y: number }[] }> {
  const response = await fetch('/api/locate-products', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ base64Image, mimeType, products: products.map((p, i) => ({ id: p.id ?? i, name: p.name, category: p.category })) })
  });
  const data = await handleResponse(response);
  return data;
}

// --- MULTI-AGENT GENERATION (SSE) ---
export async function generateWithAgents(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  budget: string,
  customShops: string[] | undefined,
  location: string | undefined,
  onProgress: (update: { type: string, message?: string, data?: any }) => void
): Promise<{ result: string, products: ProductItem[], designBrief: string }> {
  return new Promise(async (resolve, reject) => {
    try {
      const token = localStorage.getItem('restyle_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const body = JSON.stringify({
        base64Image,
        mimeType,
        style,
        roomType,
        budget,
        customShops,
        location
      });

      const response = await fetch('/api/agent/generate-stream', {
        method: 'POST',
        headers,
        body
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'API request failed');
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported in this browser.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          
          // Process fully received server-sent events
          let breakIdx;
          while ((breakIdx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, breakIdx);
            buffer = buffer.slice(breakIdx + 2);
            
            if (chunk.startsWith('data: ')) {
              try {
                const dataString = chunk.slice(6);
                const parsed = JSON.parse(dataString);
                
                if (parsed.type === 'error') {
                  throw new Error(parsed.message);
                } else if (parsed.type === 'result') {
                  resolve(parsed.data);
                  return; // Exit out of the while loop entirely
                } else {
                  onProgress(parsed);
                }
              } catch (e) {
                console.warn("Error parsing chunk:", e);
              }
            }
          }
        }
        
        if (done) break;
      }
      
      // If loop finished but result never came
      reject(new Error("Stream ended before final result was received."));
    } catch (err) {
      reject(err);
    }
  });
}

