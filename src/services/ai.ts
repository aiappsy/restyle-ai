import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateRoomDesign(
  base64Image: string,
  mimeType: string,
  style: string,
  roomType: string,
  additionalInstructions?: string
): Promise<string> {
  let prompt = "";
  if (additionalInstructions) {
    prompt = `Edit this image: ${additionalInstructions}
CRITICAL: ONLY change the specific items mentioned. Keep the background, walls, and all other furniture EXACTLY the same. Ensure any new items are perfectly scaled to fit the room realistically without overcrowding.`;
  } else {
    prompt = `You are an expert interior designer. Redesign this ${roomType} in a ${style} interior design style. 
CRITICAL RULES:
1. Keep the original room structure, walls, and perspective.
2. Change the furniture, decor, lighting, and materials to match the ${style} style. 
3. GOOD DESIGN & PROPORTION: Ensure all furniture is perfectly scaled to fit the room realistically. Do NOT make furniture too large or over-crowd the space. Estimate the room's dimensions from the photo and size items appropriately so there is enough walking space.
4. Make it look highly realistic, professional, and aesthetically pleasing.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image.split(',')[1],
            mimeType: mimeType,
          },
        },
        {
          text: prompt,
        },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Failed to generate image.");
}

export const updateDesignTool: FunctionDeclaration = {
  name: 'updateDesign',
  description: 'Regenerate the room design with new instructions based on the user\'s requests.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      newInstructions: {
        type: Type.STRING,
        description: 'The EXACT, concise change requested by the user. Do not add extra fluff or descriptions. (e.g., "Change the sofa to navy blue", "Add a retro chair").'
      }
    },
    required: ['newInstructions']
  }
};

export async function sendChatMessage(
  history: { role: string, parts: { text: string }[] }[],
  message: string,
  style: string,
  roomType: string
) {
  const systemInstruction = `You are an expert interior design AI assistant. The user has just generated a design for their ${roomType} in a ${style} style.
Your goal is to help them refine the design.
CRITICAL RULES:
1. Keep your responses VERY SHORT (1-2 sentences max), constructive, and strictly to the task at hand. Never overload the user with text.
2. If the user asks for a specific change (e.g., "change the colors"), confirm exactly what they mean. Do not assume they want to change the furniture unless they say so.
3. GOOD DESIGN PRINCIPLES: Always consider scale, proportion, and flow. If a user asks for something that might be too big for the room or disrupt the flow, politely point it out and suggest an alternative, or ask for the room's measurements to be sure.
4. Once you agree on the changes, use the \`updateDesign\` tool. The \`newInstructions\` parameter MUST be extremely concise and literal (e.g., "Change the chairs to retro style. Ensure the new chairs are properly scaled to fit the room without overcrowding.").`;

  const contents = [...history, { role: 'user', parts: [{ text: message }] }];

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [updateDesignTool] }]
    }
  });

  return response;
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }, // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Aoede'
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

export interface ProductItem {
  name: string;
  price: string;
  vendor: string;
  productUrl: string;
  imageUrl: string;
  category: string;
  reason: string;
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
  let shopInstruction = "";
  if (customShops && customShops.length > 0) {
    shopInstruction = `\nCRITICAL: You MUST restrict your search to ONLY the following shops/websites: ${customShops.join(', ')}. Use search operators like 'site:example.com' to ensure products are sourced exclusively from these vendors.`;
  }

  let locationInstruction = "";
  if (shoppingMethod === 'in-store' || shoppingMethod === 'both') {
    if (location) {
      locationInstruction = `\nThe user is located in or near ${location}. You MUST prioritize finding products from brick-and-mortar stores that are physically located near ${location}.`;
    } else {
      locationInstruction = `\nThe user prefers to shop at brick-and-mortar stores. Please prioritize finding products from well-known physical retail stores.`;
    }
  } else {
    locationInstruction = `\nThe user prefers to shop online. Focus on finding products that can be purchased and shipped online.`;
  }

  const prompt = `I am redesigning this ${roomType} into a ${style} style with a ${budget} budget. 
Search the web for 6 specific, real furniture and decor items (e.g., sofa, rug, wall art, lighting) that perfectly match this new style.${locationInstruction}${shopInstruction}
You MUST use the googleSearch tool to find actual products, their current approximate prices, a direct URL to the product image, and real URLs to buy them or view them in-store.
Return the result as a JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
            { text: prompt }
          ]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Product name" },
              price: { type: Type.STRING, description: "Price with currency symbol" },
              vendor: { type: Type.STRING, description: "Store name (e.g., West Elm, Wayfair, or local store name)" },
              productUrl: { type: Type.STRING, description: "Real URL to the product or store page" },
              imageUrl: { type: Type.STRING, description: "Direct URL to an image of the product" },
              category: { type: Type.STRING, description: "e.g., Seating, Lighting, Decor" },
              reason: { type: Type.STRING, description: "Why this fits the design and shopping preference" }
            },
            required: ["name", "price", "vendor", "productUrl", "imageUrl", "category", "reason"]
          }
        }
      }
    });

    const text = response.text || "[]";
    return JSON.parse(text);
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
  const productDescriptions = products.map(p => `- ${p.name} from ${p.vendor} (${p.category})`).join('\n');
  const prompt = `Redesign this ${roomType} in a ${style} interior design style. Keep the original room structure, walls, and perspective, but specifically incorporate the following real products into the design:
${productDescriptions}

Make the new furniture and decor look as close to these specific products as possible, while maintaining a highly realistic and professional look.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image.split(',')[1],
            mimeType: mimeType,
          },
        },
        {
          text: prompt,
        },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Failed to generate image.");
}
