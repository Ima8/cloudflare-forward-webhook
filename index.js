export default {
  async fetch(request, env, ctx) {
    // 1) ดึง path ทั้งหมด (เช่น "/https://xxx/https://yyy")
    const url = new URL(request.url);
    // ตัด '/' หน้าแรกออก เพื่อให้เหลือ "https://xxx/https://yyy"
    let rawPath = url.pathname.slice(1);

    if (!rawPath) {
      return new Response(
        JSON.stringify({ error: 'No forwarding destinations found in path.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // [แก้ไข] รองรับเคสที่มีการ encode "https://", "http://"
    // เช่น https%3A%2F%2F ให้ถอดรหัสเฉพาะส่วนนั้น เพื่อไม่ไปแก้ส่วน path อื่นที่อาจตั้งใจ encode ไว้
    try {
      rawPath = rawPath.replace(/https?%3A%2F%2F/gi, (m) => decodeURIComponent(m));
    } catch (_) {}

    // 2) ใช้ Regex หา Endpoint แต่ละตัวที่ขึ้นต้นด้วย http:// หรือ https://
    //    แล้วลากยาวไปจนกว่าจะเจอ http:// / https:// ถัดไป หรือจบ string
    //    - `g` = global match
    //    - pattern นี้จะจับกลุ่มเป็น (http://... ) หรือ (https://... ) จนกว่าจะเจอ https?://
    //      ถัดไป หรือจบ string
    const pattern = /(https?:\/\/.*?)(?=https?:\/\/|$)/gi;
    const endpoints = [];
    let match;
    while ((match = pattern.exec(rawPath)) !== null) {
      // [แก้ไขเล็กน้อย] ตรวจสอบความถูกต้องของ URL ที่จับได้
      try {
        // จะ throw ถ้าไม่ใช่ URL ถูกต้อง
        new URL(match[1]);
        endpoints.push(match[1]);
      } catch (_) {
        // ข้าม URL ที่ไม่ผ่าน validation
      }
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

    // 4) ก๊อป Headers และลบของไม่จำเป็น/เสี่ยงทำให้ปลายทาง rewrite เพี้ยน
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host'); // เดิมมีอยู่แล้ว

    // [แก้ไขสำคัญ] ลบ hop-by-hop / proxy headers และพวก x-forwarded-* ที่อาจทำให้ปลายทางตีความ path ผิด
    for (const key of Array.from(forwardHeaders.keys())) {
      const k = key.toLowerCase();
      if (
        k === 'connection' ||
        k === 'keep-alive' ||
        k === 'transfer-encoding' ||
        k === 'upgrade' ||
        k === 'expect' ||
        k === 'content-length' ||
        k === 'accept-encoding' ||
        k === 'via' ||
        k === 'forwarded' ||
        k === 'origin' ||
        k.startsWith('x-forwarded-') ||
        k.startsWith('cf-') ||
        k.startsWith('sec-fetch')
      ) {
        forwardHeaders.delete(key);
      }
    }

    // 5) สร้าง Promise สำหรับ forward ไปยังทุก endpoint
    const forwardPromises = endpoints.map(async (endpoint) => {
      try {
        const forwardRequest = new Request(endpoint, {
          method: request.method,
          headers: forwardHeaders,
          // [แก้ไข] clone body ต่อปลายทางแต่ละตัว ป้องกัน side-effect เวลา fetch หลายครั้ง
          body: requestBody ? requestBody.slice(0) : undefined,
        });
        await fetch(forwardRequest);
      } catch (err) {
        console.error(`Error forwarding to ${endpoint}:`, err);
      }
    });

    // 6) รันแบบ async เบื้องหลัง ไม่บล็อกการตอบ 200 (เหมาะสำหรับ Webhook)
    // [แก้ไขเล็กน้อย] ใช้ allSettled กันกรณี error ใด ๆ ทำให้ promise ทั้งชุด reject
    ctx.waitUntil(Promise.allSettled(forwardPromises));

    // 7) ตอบ OK ทันที
    return new Response('OK', { status: 200 });
  },
};
