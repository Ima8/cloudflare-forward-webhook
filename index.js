export default {
  async fetch(request, env, ctx) {
    // 1) อ่าน path segments จาก URL
    const { pathname } = new URL(request.url);
    // ตัวอย่าง: ถ้าเรียก https://<WORKER>/aaa/bbb/ccc
    // จะได้ segments = ["aaa", "bbb", "ccc"]
    const segments = pathname.slice(1).split('/').filter(Boolean);

    // ถ้าไม่เจอ segment ใด ๆ เลย ก็ถือว่าไม่มีปลายทางให้ forward
    if (segments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No forwarding destinations specified in path.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2) อ่าน Body เดิม (ถ้ามี) เพื่อเก็บไว้ forward
    let requestBody = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // ใช้ arrayBuffer() เผื่อกรณีเป็นข้อมูล Binary/JSON
      requestBody = await request.arrayBuffer();
    }

    // 3) เตรียม Headers สำหรับ forward
    const forwardHeaders = new Headers(request.headers);
    // ลบ header ที่ไม่จำเป็น หรือต้องเปลี่ยน
    forwardHeaders.delete('host');

    // 4) สร้างชุด Promise สำหรับ forward ไปทุกปลายทาง
    //    ถ้า segment ไม่ได้ระบุ protocol (http/https) ไว้ จะ default เป็น https://
    const forwardPromises = segments.map(async (segment) => {
      let targetURL = segment;
      if (!/^https?:\/\//i.test(targetURL)) {
        targetURL = 'https://' + targetURL;
      }
      try {
        // สร้าง Request ใหม่ไปยังปลายทาง
        const forwardRequest = new Request(targetURL, {
          method: request.method,
          headers: forwardHeaders,
          body: requestBody,
        });
        // ยิง fetch
        await fetch(forwardRequest);
      } catch (err) {
        // ถ้า fetch error ก็ทำแค่ log หรือจะเก็บเป็น return ค่าไว้ก็ได้
        console.error(`Error forwarding to ${targetURL}:`, err);
      }
    });

    // 5) ใช้ ctx.waitUntil เพื่อให้ Promise ทั้งหมดรันเบื้องหลัง
    //    แล้วเราตอบ 200 กลับทันที (ป้องกัน Timeout สำหรับ Webhook)
    ctx.waitUntil(Promise.all(forwardPromises));

    // ตอบกลับ 200 OK ไม่บล็อกการ forward
    return new Response('OK', { status: 200 });
  },
};
