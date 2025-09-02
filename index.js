export default {
  async fetch(request, env, ctx) {
    // 1) ดึง path ทั้งหมด (เช่น "/https://a/https://b/https://c") จากโฮสต์ forward.sable.asia
    const url = new URL(request.url);
    let rawPath = url.pathname.slice(1); // ตัด '/' หน้าแรก

    if (!rawPath) {
      return new Response(
        JSON.stringify({ error: 'No forwarding destinations found in path.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // รองรับเคส encode โปรโตคอลทั้ง http:// และ https:// (เช่น https%3A%2F%2F)
    try {
      rawPath = rawPath.replace(/https?%3A%2F%2F/gi, (m) => decodeURIComponent(m));
    } catch (_) {}

    // 2) แยก endpoint ทีละตัว:
    //    - ใช้ lookahead ให้ต้องมี '/' คั่นก่อน http(s):// ถัดไป หรือจบสตริง
    //    - รองรับทั้ง http และ https (https? ครอบทั้งคู่)
    const pattern = /(https?:\/\/.*?)(?=\/https?:\/\/|$)/gi;
    const endpoints = [];
    let match;

    while ((match = pattern.exec(rawPath)) !== null) {
      let candidate = match[1];
      let u;

      // พยายาม parse เป็น URL; ถ้าไม่ผ่าน ลอง decode ทั้งก้อนไปอีกชั้น (กรณีทั้ง endpoint ถูก percent-encode)
      try {
        u = new URL(candidate);
      } catch {
        try { u = new URL(decodeURIComponent(candidate)); } catch { continue; }
      }

      // ตัด '/' ปลายพาธออก เพื่อลดโอกาสที่ปลายทางอ่านพาธแล้วได้เซ็กเมนต์สุดท้ายเป็นค่าว่าง -> 'null'
      u.pathname = u.pathname.replace(/\/+$/, '');

      // ผนวก query params จาก forward.sable.asia ไปยังทุก endpoint (คงของเดิม และ append ค่าใหม่)
      for (const [k, v] of url.searchParams) {
        u.searchParams.append(k, v);
      }

      endpoints.push(u.toString());
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

    // 3) เตรียม body (ส่งต่อเฉพาะเมธอดที่มีบอดี้)
    let requestBody = null;
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      requestBody = await request.arrayBuffer();
    }

    // 4) คัดกรองเฮดเดอร์ออกจากต้นฉบับ เพื่อลดผลข้างเคียงเรื่อง rewrite/route ที่ปลายทาง
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host');

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
        k === 'cookie' ||
        k.startsWith('x-forwarded-') ||
        k.startsWith('cf-') ||
        k.startsWith('sec-fetch')
      ) {
        forwardHeaders.delete(key);
      }
    }

    // 5) ยิงไปยังทุก endpoint พร้อมกัน
    const forwardPromises = endpoints.map(async (endpoint) => {
      try {
        const forwardRequest = new Request(endpoint, {
          method,
          headers: forwardHeaders,
          body: requestBody ? requestBody.slice(0) : undefined, // clone body ต่อปลายทาง
        });
        await fetch(forwardRequest);
      } catch (err) {
        console.error(`Error forwarding to ${endpoint}:`, err);
      }
    });

    // 6) รันแบบ async เบื้องหลัง ไม่บล็อกการตอบ
    ctx.waitUntil(Promise.allSettled(forwardPromises));

    // 7) ตอบ OK ทันที
    return new Response('OK', { status: 200 });
  },
};
