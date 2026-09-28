export function getClientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.length < 50) {
    return cfIp.trim();
  }

  const trustXff = process.env.TRUST_X_FORWARDED_FOR === 'true';
  if (trustXff) {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      // 仅取链条中的第一个（最接近客户端的一跳），并做长度截断防注入
      const first = xff.split(',')[0].trim();
      if (first && first.length < 50) {
        return first;
      }
    }
  }

  return 'unknown_ip';
}
