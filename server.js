import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db.js';

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

// --- AI GENERATION TOOL ---
const updateDesignTool = {
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
      prompt = `Edit this image: ${additionalInstructions}\nCRITICAL: ONLY change the specific items mentioned. Keep the background, walls, and all other furniture EXACTLY the same. Ensure any new items are perfectly scaled to fit the room realistically without overcrowding. Make sure the lighting and shadows of the new items match the existing environment perfectly.`;
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
    const { history, message, style, roomType } = req.body;
    const systemInstruction = `You are a world-renowned Master Interior Designer and Architectural Expert. The user has just generated a design for their ${roomType} in a ${style} style.
Your goal is to act as their personal, highly-educated design consultant to help them refine this space.

CRITICAL RULES:
1. EDUCATIONAL & AUTHORITATIVE: Speak with the confidence and deep knowledge of a master designer. Explain *why* certain design choices work (e.g., color theory, spatial balance, focal points, material contrast).
2. TONE: Be highly engaging, inspiring, and wonderfully descriptive. Use Markdown formatting (bullet points, bold text) to organize your thoughts beautifully. Teach the user something new about design in your responses!
3. COLLABORATIVE REFINEMENT: If the user asks for a vague change ("make it bold", "surprise me"), suggest exactly what you intend to do (e.g., "I suggest we introduce a vibrant burnt orange velvet sofa to serve as our focal point, grounded by a dark walnut coffee table. This will create stunning contrast!").
4. GOOD DESIGN PRINCIPLES: Always prioritize scale, proportion, and flow. If you change furniture, mention that you will ensure it scales correctly to the room's footprint safely without overcrowding.
5. EXECUTING CHANGES: Once you agree on what to change, trigger the \`updateDesign\` tool immediately. The \`newInstructions\` parameter MUST be a literal, descriptive prompt for an image generation model (e.g., "Replace the main sofa with a burnt orange velvet Mid-Century sofa. Add a dark walnut coffee table. Leave the rest of the room exactly as it is. Ensure lighting matches.").`;

    const contents = [...history, { role: 'user', parts: [{ text: message }] }];

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
Search the web for 6 specific, real furniture and decor items (e.g., sofa, rug, wall art, lighting) that perfectly match this new style.${locationInstruction}${shopInstruction}
You MUST use the googleSearch tool to find actual products, their current approximate prices, a direct URL to the product image, and real URLs to buy them or view them in-store.
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
              reason: { type: Type.STRING, description: "Why this fits the design and shopping preference" }
            },
            required: ["name", "price", "vendor", "productUrl", "imageUrl", "category", "reason"]
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

app.post('/api/regenerate-products', authenticateToken, checkCredits, async (req, res) => {
  try {
    const { base64Image, mimeType, style, roomType, products } = req.body;
    const productDescriptions = products.map(p => `- ${p.name} from ${p.vendor} (${p.category})`).join('\n');
    const prompt = `Redesign this ${roomType} in a ${style} interior design style. Keep the original room structure, walls, and perspective, but specifically incorporate the following real products into the design:\n${productDescriptions}\n\nMake the new furniture and decor look as close to these specific products as possible, while maintaining a highly realistic and professional look.`;

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
    console.error("Regenerate Products Error:", error);
    res.status(500).json({ error: "Failed to regenerate products" });
  }
});

// Fallback for React routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
