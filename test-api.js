import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  try {
    const products = [
      {
        name: "Test Sofa",
        category: "Sofa",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/13-11-02-olb-by-RalfR-03.jpg/800px-13-11-02-olb-by-RalfR-03.jpg",
        visualDescription: "A beautiful modern grey sofa."
      }
    ];

    const base64Image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const mimeType = "image/png";
    const prompt = "A modern living room.";

    console.log("Starting parallel fetch...");
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
    console.log(`Fetched ${rawProductParts.length} images.`);

    try {
      console.log("Calling Image Model directly with multiple parts...");
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: base64Image.split(',')[1], mimeType: mimeType } },
            ...rawProductParts,
            { text: prompt },
          ],
        },
      });
      console.log("Generative Model Success:", !!response);
      return;
    } catch (e) {
      console.log("Generative Model ERROR json:", JSON.stringify(e, null, 2));
      console.log("Generative Model ERROR message:", e.message);
      
      console.log("Testing Fallback...");
      try {
        const visionSynth = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            ...rawProductParts,
            { text: `Analyze these images.` }
          ]
        });
        console.log("Vision Synth Success:", visionSynth.text);
      } catch (err) {
        console.log("Vision Synth ERROR json:", JSON.stringify(err, null, 2));
      }
    }

  } catch (error) {
    console.error("Test failed:", error);
  }
}

test();
