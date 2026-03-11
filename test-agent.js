// Native fetch is available in Node 18+

const dummyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function run() {
  console.log("1. Logging in...");
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'password' })
  });
  
  const loginData = await loginRes.json();
  if (!loginData.token) {
    console.error("Login failed:", loginData);
    return;
  }
  
  console.log("2. Starting Multi-Agent Stream...");
  const streamRes = await fetch('http://localhost:3001/api/agent/generate-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${loginData.token}`
    },
    body: JSON.stringify({
      base64Image: dummyImage,
      mimeType: 'image/png',
      style: 'Mid-Century Modern',
      roomType: 'Living Room',
      budget: 'moderate',
      customShops: []
    })
  });

  if (!streamRes.ok) {
    console.error("Stream request failed:", streamRes.status, await streamRes.text());
    return;
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.type === 'status') {
              console.log(`[AGENT STATUS] ${data.message}`);
            } else if (data.type === 'result') {
              console.log(`[AGENT SUCCESS] Final image received! Length: ${data.data.result.length}`);
            } else if (data.type === 'error') {
              console.error(`[AGENT ERROR] ${data.message}`);
            }
          } catch(e) {}
        }
      }
    }
    if (done) {
      console.log("Stream ended naturally.");
      break;
    }
  }
}

run();
