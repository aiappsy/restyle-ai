export interface ProductItem {
  name: string;
  price: string;
  vendor: string;
  productUrl: string;
  imageUrl: string;
  category: string;
  reason: string;
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
