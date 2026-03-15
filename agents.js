import { GoogleGenAI, Type } from '@google/genai';

let aiInstance = null;
const getAi = () => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiInstance;
};

/**
 * Orchestrates the multi-agent room generation process.
 * 
 * @param {Object} input - { base64Image, mimeType, style, roomType, additionalInstructions, budget, customShops, location }
 * @param {Function} onProgress - Callback to stream updates to the client: (message) => void
 */
export async function runAgentWorkflow(input, onProgress) {
  const { base64Image, mimeType, style, roomType, additionalInstructions, budget, customShops, location } = input;
  let context = {
    designBrief: null,
    products: [],
    coordinates: [],
    finalImage: null
  };

  try {
    // -------------------------------------------------------------
    // Agent 1: The Lead Designer
    // -------------------------------------------------------------
    onProgress({ type: 'status', message: 'Lead Designer is analyzing your room...' });
    context.designBrief = await runDesignerAgent(input);
    onProgress({ type: 'status', message: `Designer finished brief: Focus on ${style} aesthetics.` });

    // -------------------------------------------------------------
    // Agent 2: The Personal Shopper
    // -------------------------------------------------------------
    onProgress({ type: 'status', message: 'Personal Shopper is looking for real products...' });
    context.products = await runShopperAgent({ ...input, designBrief: context.designBrief }, onProgress);
    onProgress({ type: 'status', message: `Shopper found ${context.products.length} products.` });

    if (context.products.length === 0) {
      throw new Error("Shopper could not find suitable products.");
    }

    // -------------------------------------------------------------
    // Agent 3: The Spatial Layout Agent
    // -------------------------------------------------------------
    onProgress({ type: 'status', message: 'Spatial Agent is mapping out product placements...' });
    context.coordinates = await runSpatialAgent({ base64Image, mimeType, products: context.products });
    onProgress({ type: 'status', message: 'Spatial mapping complete.' });

    // -------------------------------------------------------------
    // Agent 4: The Render Studio
    // -------------------------------------------------------------
    onProgress({ type: 'status', message: 'Render Studio is generating the final masterpiece...' });
    context.finalImage = await runRenderAgent({ ...input, products: context.products, coordinates: context.coordinates, designBrief: context.designBrief });
    onProgress({ type: 'status', message: 'Render complete!' });

    return context.finalImage;

  } catch (error) {
    console.error("Agent Workflow Failed:", error);
    onProgress({ type: 'error', message: error.message || 'An error occurred during the multi-agent workflow.' });
    throw error;
  }
}

// ============================================================================
// AGENT IMPLEMENTATIONS
// ============================================================================

async function runDesignerAgent({ roomType, style, additionalInstructions }) {
  const prompt = `You are a world-class Lead Interior Designer.
Your task is to create a highly specific, 2-paragraph design brief for a ${roomType} in the ${style} style.
${additionalInstructions ? `The user also requested: "${additionalInstructions}". Incorporate this.` : ''}
Focus on naming exactly 4-6 key pieces of furniture or decor that we must buy to achieve this look. Be very specific about colors, materials, and vibe (e.g. "a rust-orange velvet accent chair with brass legs").
Return ONLY the text of the brief.`;

  const result = await getAi().models.generateContent({
    model: 'gemini-1.5-flash',
    contents: { parts: [{ text: prompt }] }
  });
  return result.text;
}

async function runShopperAgent({ base64Image, mimeType, style, roomType, budget, customShops, location, designBrief }, onProgress) {
  let shopInstruction = "";
  if (customShops && customShops.length > 0) {
    shopInstruction = `\nCRITICAL: You MUST restrict your search to ONLY the following shops/websites: ${customShops.join(', ')}. Use search operators like 'site:example.com'.`;
  }

  const prompt = `You are an elite Personal Shopper for interior design. 
Here is the Lead Designer's brief for a ${style} ${roomType}:\n"${designBrief}"\n
Budget constraint: ${budget || 'Unlimited'}.
${shopInstruction}

Search the web using googleSearch for 4-6 specific, real products that perfectly match the brief.
CRITICAL RULES:
1. The imageUrl MUST be a direct, publicly accessible image URL ending in .jpg or .png.
2. Provide a 2-sentence "visualDescription" for each product so our Render Team knows exactly how it looks physically (color, material, shape, legs, texture).
Return the result EXACTLY as a raw JSON array of objects with keys: name, price, vendor, productUrl, imageUrl, category, reason, visualDescription. No markdown formatting.`;

  onProgress({ type: 'status', message: 'Shopper is using Google Search to source items...' });

  const result = await getAi().models.generateContent({
    model: 'gemini-2.5-pro',
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: prompt }
      ]
    },
    tools: [{ googleSearch: {} }]
  });

  let text = result.text || "[]";
  const match = text.match(/\[[\s\S]*\]/);
  if (match) text = match[0];
  let products = JSON.parse(text);

  // --- VISION QA STEP ---
  const verifiedProducts = [];
  onProgress({ type: 'status', message: `Vision QA is verifying ${products.length} products...` });

  const verifyProduct = async (p) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(p.imageUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.log(`[Shopper QA Drop] Image failed with HTTP ${res.status} for:`, p.imageUrl);
        return;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 100) return;

      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = res.headers.get('content-type') || 'image/jpeg';

      const qaResult = await getAi().models.generateContent({
        model: 'gemini-1.5-flash',
        contents: {
          parts: [
            { inlineData: { data: base64, mimeType: mimeType } },
            { text: `Analyze this furniture image. The category should be ${p.category}. Is it correct? (e.g. if category is Sofa, it MUST be a sofa, not a chair). Respond YES or NO. Output ONLY YES or NO.` }
          ]
        }
      });

      const decision = (qaResult.text || '').trim().toUpperCase();
      if (decision.includes('NO')) {
        console.warn(`[Shopper QA Reject] ${p.name} rejected. Expected: ${p.category}, AI saw: ${decision}`);
      } else {
        verifiedProducts.push(p);
      }
    } catch (e) {
      console.warn(`[Shopper QA Error] Verification failed for ${p.name}:`, e.message);
      verifiedProducts.push(p);
    }
  };

  await Promise.all(products.map(verifyProduct));

  if (verifiedProducts.length < products.length) {
    onProgress({ type: 'status', message: `Vision QA dropped ${products.length - verifiedProducts.length} items.` });
  }

  return verifiedProducts;
}

async function runSpatialAgent({ base64Image, mimeType, products }) {
  if (products.length === 0) return [];

  const prompt = `Analyze this empty room context. I have a list of products that need to be placed here.
For each product, identify the ideal, most logical location in the image and provide the (x, y) coordinates of its center point as percentages (0 to 100).
x: 0, y: 0 is top-left.

Products to place:
${products.map((p, i) => `ID ${i}: ${p.name} (${p.category})`).join('\n')}

Return the spatial map as a JSON array.`;

  const result = await getAi().models.generateContent({
    model: "gemini-2.5-pro",
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            productId: { type: Type.INTEGER },
            x: { type: Type.INTEGER },
            y: { type: Type.INTEGER }
          },
          required: ["productId", "x", "y"]
        }
      }
    }
  });

  return JSON.parse(result.text || "[]");
}

async function runRenderAgent({ base64Image, mimeType, style, roomType, products, coordinates, designBrief }) {
  const detailedDescriptions = products.map((p, i) => {
    const loc = coordinates.find(c => c.productId === i);
    const locText = loc ? `[Spatial Requirement: approx center at X:${loc.x}%, Y:${loc.y}%]` : '';
    return `"${p.name}" (${p.category}): ${p.visualDescription} ${locText}`;
  }).join('\n\n');

  const prompt = `You are an expert interior design renderer. Redesign this ${roomType} beautifully in the ${style} style.
CRITICAL INSTRUCTION: You MUST incorporate the following exact furniture pieces into the scene:

${detailedDescriptions}

Lead Designer's Brief Note:
"${designBrief}"

RULES:
1. Keep the room's core architecture exactly the same.
2. Perfectly incorporate the items described above. Replicate their color, material, and shape, placing them at the requested spatial coordinates where possible!
3. Render a photo-realistic, completely believable image.`;

  // Fetch product images for vision synthesis
  const fetchImage = async (product) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const imgRes = await fetch(product.imageUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        return { data: Buffer.from(buffer).toString('base64'), mimeType: imgRes.headers.get('content-type') || 'image/jpeg' };
      }
    } catch(e) { return null; }
  };
  
  const fetchedImages = (await Promise.all(products.map(fetchImage))).filter(Boolean);
  const rawProductParts = fetchedImages.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } }));

  let elitePrompt = prompt;
  if (rawProductParts.length > 0) {
    try {
      const synthResult = await getAi().models.generateContent({
        model: "gemini-1.5-flash",
        contents: {
          parts: [
            ...rawProductParts,
            { text: `Analyze these real product images. Write a precise physical description of how to render these specific items mathematically inside a ${roomType}. Output ONLY the directives.` }
          ]
        }
      });
      elitePrompt += `\n\nPHYSICAL DIRECTIVES (Follow precisely):\n${synthResult.text}`;
    } catch (err) {
      console.warn("Vision Synth skipped");
    }
  }

  const result = await getAi().models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: elitePrompt },
      ],
    },
  });

  for (const part of result.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return { 
        result: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        products: products,
        designBrief: designBrief
      };
    }
  }
  
  throw new Error("Failed to generate final image.");
}

/**
 * Generates an initial AI mockup design based on style and room type.
 */
export async function runMockupAgent(input) {
  const { base64Image, mimeType, style, roomType, additionalInstructions } = input;

  const prompt = `You are a world-class interior designer. Generate a stunning, high-fidelity mockup design for a ${style} ${roomType}. 
  ${additionalInstructions ? `Incorporate these requests: "${additionalInstructions}"` : ''}
  
  RULES:
  1. Keep the room's core architecture exactly the same.
  2. Create a fully furnished, beautiful design inspiration.
  3. Render a photo-realistic, completely believable image.`;

  const result = await getAi().models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: prompt },
      ],
    },
  });

  for (const part of result.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("Failed to generate mockup image.");
}

/**
 * Identifies furniture category and style from click coordinates.
 */
export async function runIdentifyFurnitureAgent(input) {
  const { base64Image, mimeType, x, y } = input;

  const prompt = `You are an expert furniture identifier. I am clicking on a room image at coordinates X:${x}%, Y:${y}%.
  Identify the specific furniture item or decor element at this location.
  
  Return ONLY a JSON object with:
  - category: (e.g., "Sofa", "Accent Chair", "Coffee Table", "Wall Art", "Plant")
  - visualDescription: (A 2-sentence precise physical description of the EXACT item seen in the image at those coordinates - color, material, shape)
  - searchKeywords: (3-5 keywords for finding real products like this)
  
  If nothing specific is there, return category: "Unknown".`;

  const result = await getAi().models.generateContent({
    model: "gemini-1.5-flash",
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: prompt },
      ],
    },
  });

  let text = result.text || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  return JSON.parse(text);
}

// ============================================================================
// NEW: INTERACTIVE LAYOUT FLOW
// ============================================================================

export async function runSourcingAgentForLayout(input) {
  const { base64Image, mimeType, style, roomType, budget, placedItems, customShops, location } = input;
  
  // Categorize grouped items to avoid redundant searches for identical categories (like 4 dining chairs)
  const categoriesToSource = [...new Set(placedItems.map(item => item.category))];
  
  console.log(`[Layout Sourcing] Finding options for: ${categoriesToSource.join(', ')}`);
  
  let shopInstruction = "";
  if (customShops && customShops.length > 0) {
    shopInstruction = `\nCRITICAL: You MUST restrict your search to ONLY the following shops/websites: ${customShops.join(', ')}. Use search operators like 'site:example.com'.`;
  }

  const categorizedProducts = {};

  // Run searches in parallel
  await Promise.all(categoriesToSource.map(async (category) => {
    const prompt = `You are an elite Personal Shopper for interior design. 
We are designing a ${style} ${roomType}. Budget is ${budget || 'Unlimited'}.
${shopInstruction}

Search the web using googleSearch for 6 to 10 HIGHLY VARIANT, beautiful, real products that fit the category: "${category}".
Ensure they fit perfectly within a ${style} aesthetic.

CRITICAL RULES:
1. ONLY return products that are actually ${category}s. (e.g. if the category is "Sofa", do NOT return chairs or armchairs, even if they are from the same collection).
2. Prioritize reputable furniture brands (e.g., Article, Crate & Barrel, West Elm, IKEA, IKEA.com, Wayfair) where images are easily accessible.
3. The imageUrl MUST be a direct, publicly accessible image URL ending in .jpg or .png.
4. Provide a 2-sentence "visualDescription" for each product so our Render Team knows exactly how it physically looks.
Return the result EXACTLY as a raw JSON array of objects with keys: name, price, vendor, productUrl, imageUrl, category, reason, visualDescription. No markdown formatting.`;

    const result = await getAi().models.generateContent({
      model: "gemini-2.5-pro",
      contents: { parts: [{ text: prompt }] },
      tools: [{ googleSearch: {} }]
    });

    let text = result.text || "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) text = match[0];
    let products = JSON.parse(text);
    
    // --- VISION QA STEP ---
    const verifiedProducts = [];
    console.log(`[Vision QA] Verifying ${products.length} products for category: ${category}`);

    const verifyImage = async (p) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const imgRes = await fetch(p.imageUrl, { 
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        clearTimeout(timeoutId);

        if (!imgRes.ok) {
          console.warn(`[Vision QA Skip] ${p.name} image inaccessible (HTTP ${imgRes.status}). Accepting by default.`);
          verifiedProducts.push({ ...p, category });
          return;
        }

        const buffer = await imgRes.arrayBuffer();
        if (buffer.byteLength < 100) {
          console.warn(`[Vision QA Skip] ${p.name} image too small (${buffer.byteLength} bytes).`);
          return;
        }
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

        const result = await getAi().models.generateContent({
          model: 'gemini-1.5-flash',
          contents: {
            parts: [
              { inlineData: { data: base64, mimeType: mimeType } },
              { text: `Analyze this furniture image. Is this a ${category}? 
              
              CRITICAL: 
              - A SOFA must be a multi-person seat.
              - A CHAIR or ARMCHAIR is for one person.
              - If the item is a ${category}, respond exactly with 'YES'.
              - If it is NOT a ${category} (e.g. you see a chair but I asked for a sofa), respond exactly with 'NO'.
              - If it's a completely different object, respond 'NO'.
              
              Output ONLY 'YES' or 'NO'.` }
            ]
          }
        });

        const decision = (result.text || '').trim().toUpperCase();
        console.log(`[Vision QA] "${p.name}" -> ${decision}`);

        if (decision.includes('NO')) {
          console.warn(`[Vision QA REJECT] "${p.name}" is NOT a ${category}. Dropping it.`);
        } else {
          verifiedProducts.push({ ...p, category }); 
        }

      } catch (err) {
        console.warn(`[Vision QA Error] Failed to verify ${p.name}:`, err.message);
        // Fallback: Accept if verification fails due to technical reasons
        verifiedProducts.push({ ...p, category }); 
      }
    };

    // Run verification in parallel with a concurrency limit if needed, 
    // but Promise.all is fine for 6-10 items.
    await Promise.all(products.map(verifyImage));

    categorizedProducts[category] = verifiedProducts;
  }));

  return categorizedProducts;
}

export async function runRenderAgentForLayout(input) {
  const { base64Image, mimeType, style, roomType, selectedProducts } = input;
  
  // selectedProducts now includes .coordinates = {x, y} percentage strings or numbers!
  const detailedDescriptions = selectedProducts.map(p => {
    let locText = "";
    if (p.coordinates) {
       locText = `[MANDATORY SPATIAL REQUIREMENT: Place exactly at X:${p.coordinates.x}%, Y:${p.coordinates.y}%]`;
    }
    return `"${p.name}" (${p.category}): ${p.visualDescription}. ${locText}`;
  }).join('\n\n');

  const prompt = `You are a world-class architectural rendering engine. Redesign this ${roomType} into a masterpiece ${style} style.
CRITICAL INSTRUCTION: You MUST incorporate the following exact furniture pieces into the scene at their specified spatial coordinates:

${detailedDescriptions}

RULES:
1. Keep the room's core architecture exactly the same.
2. Perfectly incorporate the exact items described above. Replicate their color, material, and shape, placing them at the EXACT (X, Y) spatial percentages requested.
3. Render a photo-realistic, magnificent image.`;

  // Fetch product images for vision synthesis
  const fetchImage = async (product) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const imgRes = await fetch(product.imageUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (imgRes.ok) {
         const buffer = await imgRes.arrayBuffer();
         return { data: Buffer.from(buffer).toString('base64'), mimeType: imgRes.headers.get('content-type') || 'image/jpeg' };
      }
    } catch(e) { return null; }
  };
  
  const fetchedImages = (await Promise.all(selectedProducts.map(fetchImage))).filter(Boolean);
  const rawProductParts = fetchedImages.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } }));

  let elitePrompt = prompt;
  if (rawProductParts.length > 0) {
    try {
      const synthResult = await getAi().models.generateContent({
        model: "gemini-1.5-flash",
        contents: {
          parts: [
            ...rawProductParts,
            { text: `Analyze these real product images. Write a precise physical description of how to physically model and render these specific items mathematically inside a ${roomType}. Output ONLY the physical shape directives.` }
          ]
        }
      });
      elitePrompt += `\n\nPHYSICAL DIRECTIVES (Follow precisely):\n${synthResult.text}`;
    } catch (err) {
      console.warn("Vision Synth skipped");
    }
  }

  const result = await getAi().models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
        { text: elitePrompt },
      ],
    },
  });

  for (const part of result.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("Failed to generate final image.");
}
