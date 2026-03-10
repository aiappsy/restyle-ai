export interface ProductItem {
  name: string;
  price: string;
  vendor: string;
  productUrl: string;
  imageUrl: string;
  category: string;
  reason: string;
}

export async function generateRoomDesign(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  additionalInstructions?: string
): Promise<string> {
  const response = await fetch('/api/generate-design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image, mimeType, style, roomType, additionalInstructions })
  });
  if (!response.ok) throw new Error('Failed to generate design');
  const data = await response.json();
  return data.result;
}

export async function sendChatMessage(
  history: { role: string, parts: { text: string }[] }[],
  message: string,
  style: string,
  roomType: string
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, message, style, roomType })
  });
  if (!response.ok) throw new Error('Failed to process chat');
  return await response.json();
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Image, mimeType, style, roomType, budget, customShops, location, shoppingMethod })
    });
    if (!response.ok) throw new Error('Failed to generate shopping list');
    const data = await response.json();
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image, mimeType, style, roomType, products })
  });
  if (!response.ok) throw new Error('Failed to regenerate products');
  const data = await response.json();
  return data.result;
}
