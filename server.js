import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db.js';
import { runAgentWorkflow } from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Secret for JWT
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-restyle-key-123';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Setup uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Serve static files in production
app.use(express.static(path.join(__dirname, 'dist')));

// --- AUTH MIDDLEWARE ---

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token." });
    req.user = user;
    next();
  });
};

const checkCredits = (req, res, next) => {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.userId);
  if (!user || user.credits <= 0) {
    return res.status(403).json({ error: "You have run out of credits. Please upgrade to continue." });
  }
  next();
};

const deductCredit = (userId) => {
  db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
};

// --- AUTH ENDPOINTS ---

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, location } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Missing required fields" });

  try {
    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existingUser) return res.status(400).json({ error: "Email already registered" });

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    
    // Check if this is the first user
    const userCountRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const isFirstUser = userCountRow.count === 0;
    const role = isFirstUser ? 'admin' : 'user';
    const credits = isFirstUser ? 999999 : 5;

    const stmt = db.prepare('INSERT INTO users (name, email, password_hash, location, role, credits) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, email, password_hash, location || null, role, credits);
    
    const token = jwt.sign({ userId: result.lastInsertRowid, email, role }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({ token, user: { id: result.lastInsertRowid, name, email, location, role, credits } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(400).json({ error: "Invalid email or password" });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: "Invalid email or password" });

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    // Don't leak the hash
    delete user.password_hash;
    
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during login" });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, email, location, role, credits, created_at FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// --- ADMIN ENDPOINTS ---

app.get('/api/admin/users', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const users = db.prepare('SELECT id, name, email, location, role, credits, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// --- DESIGNS ENDPOINTS ---

app.post('/api/designs/save', authenticateToken, async (req, res) => {
  const { originalBase64, generatedBase64, style, roomType } = req.body;
  if (!originalBase64 || !generatedBase64 || !style || !roomType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const origData = originalBase64.replace(/^data:image\/\w+;base64,/, "");
    const genData = generatedBase64.replace(/^data:image\/\w+;base64,/, "");

    const origFileName = `orig_${req.user.userId}_${Date.now()}.png`;
    const genFileName = `gen_${req.user.userId}_${Date.now()}.png`;

    fs.writeFileSync(path.join(uploadsDir, origFileName), Buffer.from(origData, 'base64'));
    fs.writeFileSync(path.join(uploadsDir, genFileName), Buffer.from(genData, 'base64'));

    const origPath = `/uploads/${origFileName}`;
    const genPath = `/uploads/${genFileName}`;

    const stmt = db.prepare('INSERT INTO designs (user_id, original_image, generated_image, style, room_type) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(req.user.userId, origPath, genPath, style, roomType);

    res.status(201).json({ success: true, designId: result.lastInsertRowid });
  } catch (err) {
    console.error("Save Design Error:", err);
    res.status(500).json({ error: "Failed to save design" });
  }
});

app.get('/api/designs', authenticateToken, (req, res) => {
  try {
    const designs = db.prepare('SELECT id, original_image, generated_image, style, room_type, created_at FROM designs WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
    res.json({ designs });
  } catch (err) {
    console.error("Get Designs Error:", err);
    res.status(500).json({ error: "Failed to fetch saved designs" });
  }
});

// --- AI GENERATION TOOL ---
const updateDesignTool = {
  name: 'updateDesign',
  description: 'Regenerate the room design with new instructions based on the user\'s requests.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      newInstructions: {
        type: Type.STRING,
        description: 'A FULL, highly-detailed, and comprehensive description of the ENTIRE room as it should look after the changes are made. (e.g., "A stylish modern living room featuring a rich navy blue velvet sofa, a sleek glass coffee table, white walls, and bright natural sunlight"). DO NOT just send short commands like "Change the sofa to blue". You must describe the entire room, including the things that stay the same.'
      }
    },
    required: ['newInstructions']
  }
};

// --- GEMINI ENDPOINTS (Protected) ---

app.post('/api/generate-design', authenticateToken, checkCredits, async (req, res) => {
  try {
    const { base64Image, mimeType, style, roomType, additionalInstructions } = req.body;
    const lightingVariations = [
      "bathed in warm, golden-hour natural sunlight",
      "featuring moody, cinematic lighting with strong contrasting shadows",
      "illuminated by soft, diffused, overcast morning light",
      "with bright, airy, and crisp high-key lighting",
      "featuring dramatic accent lighting highlighting architectural details",
      "with a cozy, inviting, and layered ambient lighting scheme"
    ];
    
    const atmosphereVariations = [
      "infusing a sense of calm minimalism and breathing room",
      "incorporating bold, unexpected statement pieces that spark conversation",
      "layering rich, tactile textures for a lived-in, curated feel",
      "emphasizing sleek, architectural lines and perfect symmetry",
      "blending organic, nature-inspired elements seamlessly indoors",
      "with a slightly eclectic, highly personal, and worldly touch"
    ];

    const randomLighting = lightingVariations[Math.floor(Math.random() * lightingVariations.length)];
    const randomAtmosphere = atmosphereVariations[Math.floor(Math.random() * atmosphereVariations.length)];

    let prompt = "";
    if (additionalInstructions) {
      prompt = `Redesign this ${roomType} using the following detailed description as your ultimate guide:
"${additionalInstructions}"

CRITICAL RULES:
1. Keep the exact original architectural structure, walls, windows, and perspective perfectly intact.
2. Apply the beautiful design items described above.
3. GOOD DESIGN & PROPORTION: Ensure the scene is perfectly balanced and furniture is realistically scaled. Do NOT over-crowd the space. Leave realistic walking paths.
4. Make sure the lighting and shadows match the environment perfectly.
5. Create a photorealistic, breathtakingly beautiful render.`;
    } else {
      prompt = `You are an expert, world-class interior designer. Redesign this ${roomType} in a truly exceptional ${style} interior design style.
      
CRITICAL RULES:
1. Keep the exact original room structure, walls, windows, and perspective perfectly intact.
2. Completely reimagine the furniture, decor, materials, and color palette to embody the absolute highest-end, magazine-quality execution of the ${style} style.
3. UNIQUE VARIATION: Ensure the scene is ${randomLighting}, while ${randomAtmosphere}. DO NOT generate a generic or cliché layout.
4. GOOD DESIGN & PROPORTION: Estimate the room's physical dimensions. Ensure all furniture is perfectly scaled. Do NOT over-crowd the space. Leave realistic walking paths.
5. Create a highly photorealistic, breathtakingly beautiful render.`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
          { text: prompt },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        deductCredit(req.user.userId);
        return res.json({ result: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
      }
    }
    throw new Error("Failed to generate image.");
  } catch (error) {
    console.error("Generate Design Error:", error);
    res.status(500).json({ error: "Failed to generate design" });
  }
});


app.post('/api/chat', authenticateToken, checkCredits, async (req, res) => {
  try {
    const { history, message, style, roomType, base64Image, mimeType } = req.body;
    const systemInstruction = `You are a world-renowned Master Interior Designer and Architectural Expert. The user has just generated a design for their ${roomType} in a ${style} style.
Your goal is to act as their personal, highly-educated design consultant to help them refine this space.
Look carefully at the image provided to understand the current layout and furniture.

CRITICAL RULES:
1. EDUCATIONAL & AUTHORITATIVE: Speak with the confidence and deep knowledge of a master designer. Explain *why* certain design choices work (e.g., color theory, spatial balance, focal points, material contrast).
2. TONE: Be highly engaging, inspiring, and wonderfully descriptive. Use Markdown formatting (bullet points, bold text) to organize your thoughts beautifully. 
3. COLLABORATIVE REFINEMENT: If the user asks for a vague change ("make it bold"), suggest exactly what you intend to do. 
4. EXECUTING CHANGES: Once you agree on what to change, trigger the \`updateDesign\` tool immediately. The \`newInstructions\` parameter MUST be a FULL, HOLISTIC description of the ENTIRE room as it should look after the change. For example, do not just send "Change sofa to blue". Instead, you MUST write: "A breathtaking modern living room featuring a beautiful navy blue velvet sofa as the focal point, accented by a geometric rug, warm walnut hardwood floors, and large windows bringing in natural light." The image generator needs the FULL architectural context of the room to render it correctly!`;

    const userParts = [];
    if (base64Image && mimeType) {
      userParts.push({ inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } });
    }
    userParts.push({ text: message });

    const contents = [...history, { role: 'user', parts: userParts }];

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [updateDesignTool] }]
      }
    });

    const calls = response.functionCalls || [];
    
    // Safely extract text because when a model ONLY returns a function call, accessing response.text throws an Error in the SDK.
    let responseText = "";
    try {
      if (response.text) responseText = response.text;
    } catch (e) {
      // Intentionally swallow the "response contains no text" error
      // It just means the AI decided to update the design without saying anything first.
    }
    
    res.json({ text: responseText, functionCalls: calls });
  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

app.post('/api/speech', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    res.json({ audio: base64Audio || null });
  } catch (error) {
    console.error("TTS Error:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

app.post('/api/shopping-list', authenticateToken, checkCredits, async (req, res) => {
  try {
    const { base64Image, mimeType, style, roomType, budget, customShops, location, shoppingMethod } = req.body;
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
Search the web for 6 specific, real furniture and decor items (e.g., sofa, rug, wall art, lighting) that perfectly match this new style.
You MUST use the googleSearch tool to find actual products.
CRITICAL: The imageUrl MUST be a direct, publicly accessible image URL ending in .jpg or .png. If you cannot find a verified, direct image URL from your search, you MUST leave the imageUrl field completely blank (""). DO NOT hallucinate URLs.
ALSO CRITICAL: You must write a "visualDescription" for each product based on the images and descriptions you find. This should be a 2-sentence microscopic visual description (color, material, shape) so an artist can perfectly draw it without seeing the picture.
Return the result as a JSON array.`;

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
              reason: { type: Type.STRING, description: "Why this fits the design and shopping preference" },
              visualDescription: { type: Type.STRING, description: "Highly detailed visual description of the product (color, material, shape) for an artist to draw it" }
            },
            required: ["name", "price", "vendor", "productUrl", "imageUrl", "category", "reason", "visualDescription"]
          }
        }
      }
    });

    deductCredit(req.user.userId);
    const text = response.text || "[]";
    res.json({ products: JSON.parse(text) });
  } catch (error) {
    console.error("Shopping List Error:", error);
    res.status(500).json({ error: "Failed to generate shopping list" });
  }
});

app.post('/api/locate-products', authenticateToken, async (req, res) => {
  try {
    const { base64Image, mimeType, products } = req.body;
    
    const prompt = `Analyze this interior design image. I have a list of products that were placed in this room.
For each product, identify its location in the image and provide the (x, y) coordinates of its center point as percentages (0 to 100).
For example, x: 50, y: 50 is the exact center of the image. x: 0, y: 0 is the top-left corner.
If you cannot clearly see a product from the list, or it's not visible, omit it from the results.

Products to find:
${products.map(p => `ID ${p.id}: ${p.name} (${p.category})`).join('\n')}

Return the result as a JSON array.`;

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
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.INTEGER, description: "The ID of the product" },
              x: { type: Type.INTEGER, description: "X coordinate percentage (0-100), 0=left, 100=right" },
              y: { type: Type.INTEGER, description: "Y coordinate percentage (0-100), 0=top, 100=bottom" }
            },
            required: ["productId", "x", "y"]
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || "[]");
    res.json({ coordinates: parsed });
  } catch (error) {
    console.error("Locate Products Error:", error);
    res.status(500).json({ error: "Failed to locate products in image" });
  }
});

app.post('/api/regenerate-products', authenticateToken, checkCredits, async (req, res) => {
  try {
    const { base64Image, mimeType, style, roomType, products } = req.body;

    const detailedDescriptions = products.map(p => `"${p.name}" (${p.category}): ${p.visualDescription}`).join('\n\n');

    const prompt = `You are an expert interior designer. Redesign this ${roomType} perfectly in the ${style} style.
CRITICAL INSTRUCTION: You MUST incorporate the following exact furniture items into the scene based on their detailed visual descriptions:

${detailedDescriptions}

RULES:
1. Keep the room's core architecture, walls, and perspective exactly the same.
2. Perfectly incorporate the exact pieces of furniture described above. Replicate their color, material, and shape precisely, making them the stars of the room!
3. Ensure brilliant lighting matching the environment and perfectly scaled furniture.
4. Render a photo-realistic, masterpiece image.`;

    // 1. Fetch raw product images directly in parallel (3s timeout) to prevent 504s!
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
    
    let rawProductParts = [];
    try {
      const fetchedImages = (await Promise.all(products.map(fetchImage))).filter(Boolean);
      rawProductParts = fetchedImages.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } }));
    } catch(e) {
      console.warn("Skipping parallel image fetch...", e);
    }

    let elitePrompt = prompt;
    if (rawProductParts.length > 0) {
      console.log(`Running lightning-fast parallel vision synth on ${rawProductParts.length} products...`);
      try {
        const visionSynth = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            ...rawProductParts,
            { text: `Analyze these ${rawProductParts.length} real product images. Write an extremely precise, literal, physical description of exactly how to render these specific items mathematically (textures, colors, geometries, unique identifiers) inside a ${style} ${roomType}. Output ONLY the physical integration directives.` }
          ]
        });
        elitePrompt += `\n\nCRITICAL PHYSICAL DIRECTIVES FOR THE OBJECTS (Follow precisely):\n${visionSynth.text}`;
      } catch (err) {
        console.warn("Vision Synth skipped due to error:", err.message);
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
          { text: elitePrompt },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        deductCredit(req.user.userId);
        return res.json({ result: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
      }
    }
    throw new Error("Failed to generate image.");
  } catch (error) {
    console.error("Regenerate Products Error:", error);
    res.status(500).json({ error: "Failed to regenerate products" });
  }
});

// --- MULTI-AGENT SSE ENDPOINT ---
app.post('/api/agent/generate-stream', authenticateToken, checkCredits, async (req, res) => {
  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { base64Image, mimeType, style, roomType, additionalInstructions, budget, customShops, location } = req.body;

  if (!base64Image || !style || !roomType) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Missing required parameters' })}\n\n`);
    return res.end();
  }

  // Define the progress callback that writes to the SSE stream
  const onProgress = (update) => {
    res.write(`data: ${JSON.stringify(update)}\n\n`);
  };

  try {
    const input = {
      base64Image,
      mimeType,
      style,
      roomType,
      additionalInstructions,
      budget,
      customShops: customShops ? customShops : [],
      location
    };

    const finalResult = await runAgentWorkflow(input, onProgress);
    
    // Deduct credit only upon successful complete generation
    deductCredit(req.user.userId);
    
    res.write(`data: ${JSON.stringify({ type: 'result', data: finalResult })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Fallback for React routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
