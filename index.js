export default {
  async fetch(request, env, ctx) {
    // 1) ดึง path ทั้งหมด (เช่น "/https://xxx/https://yyy")
    const url = new URL(request.url);
    // ตัด '/' หน้าแรกออก เพื่อให้เหลือ "https://xxx/https://yyy"
    const rawPath = url.pathname.slice(1);

    if (!rawPath) {
      return new Response(
        JSON.stringify({ error: 'No forwarding destinations found in path.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2) ใช้ Regex หา Endpoint แต่ละตัวที่ขึ้นต้นด้วย http:// หรือ https://
    //    แล้วลากยาวไปจนกว่าจะเจอ http:// / https:// ถัดไป หรือจบ string
    //    - `g` = global match
    //    - pattern นี้จะจับกลุ่มเป็น (http://... ) หรือ (https://... ) จนกว่าจะเจอ https?://
    //      ถัดไป หรือจบ string
    const pattern = /(https?:\/\/.*?)(?=https?:\/\/|$)/g;
    const endpoints = [];
    let match;
    while ((match = pattern.exec(rawPath)) !== null) {
      endpoints.push(match[1]);
    }

    if (endpoints.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No valid http:// or https:// URL found in path.',
          rawPath,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3) เตรียมอ่าน body ถ้าเป็น method ที่มี body
    let requestBody = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      requestBody = await request.arrayBuffer();
    }

    // 4) ก๊อป Headers และลบของไม่จำเป็น
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host');

    // 5) สร้าง Promise สำหรับ forward ไปยังทุก endpoint
    const forwardPromises = endpoints.map(async (endpoint) => {
      try {
        const forwardRequest = new Request(endpoint, {
          method: request.method,
          headers: forwardHeaders,
          body: requestBody,
        });
        await fetch(forwardRequest);
      } catch (err) {
        console.error(`Error forwarding to ${endpoint}:`, err);
      }
    });

    // 6) รันแบบ async เบื้องหลัง ไม่บล็อกการตอบ 200 (เหมาะสำหรับ Webhook)
    ctx.waitUntil(Promise.all(forwardPromises));

    // 7) ตอบ OK ทันที
    return new Response('OK', { status: 200 });
  },
};
