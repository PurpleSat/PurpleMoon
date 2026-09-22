import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * 安全解析与校验请求体 (专为 Edge Runtime 优化)
 * @param req NextRequest
 * @param schema Zod Schema
 * @param maxSize 最大字节数，默认 512KB (512 * 1024)
 */
export async function safeParseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
  maxSize = 512 * 1024
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  try {
    // 1. 物理层拦截：以纯文本读取，避免直接 req.json() 解析巨大对象的内存开销
    const text = await req.text();
    
    if (text.length > maxSize) {
      return { 
        data: null, 
        error: NextResponse.json({ error: 'Payload Too Large: 请求体过大' }, { status: 413 }) 
      };
    }

    if (!text.trim()) {
      return { 
        data: null, 
        error: NextResponse.json({ error: 'Bad Request: 请求体不能为空' }, { status: 400 }) 
      };
    }

    // 2. 解析 JSON
    const json = JSON.parse(text);

    // 3. 结构与边界化校验 (Zod)
    const parsed = schema.safeParse(json);
    
    if (!parsed.success) {
      // 提取友好的错误信息
      const errorMessages = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { 
        data: null, 
        error: NextResponse.json({ error: '数据格式验证失败', details: errorMessages }, { status: 400 }) 
      };
    }

    return { data: parsed.data, error: null };
  } catch (error) {
    return { 
      data: null, 
      error: NextResponse.json({ error: 'Invalid JSON: 无效的 JSON 格式' }, { status: 400 }) 
    };
  }
}

// ==========================================
// 🛡️ 常用业务 Schema 定义库
// ==========================================

// 便签 (Memo) 数据限制：内容最多 2000 字符
export const memoSchema = z.object({
  id: z.string().max(100, 'ID 长度超限').optional(),
  content: z.string().min(1, '便签内容不能为空').max(2000, '便签内容最多 2000 个字符'),
  color: z.string().max(20, '颜色值异常').optional(),
});

// 历史记录 / 收藏单项：限制各类 ID 和字符串长度，防止恶意注入长文本
export const mediaItemSchema = z.object({
  id: z.string().max(100, 'ID 过长'),
  source: z.string().max(50, '源标识过长'),
  title: z.string().max(200, '标题过长').optional(),
  poster: z.string().url().max(1000, '海报链接过长').optional().or(z.literal('')),
  year: z.string().max(20).optional(),
  type_name: z.string().max(50).optional(),
});

// 批量同步接口限制：每次最多提交 100 条记录
export const syncBatchSchema = z.object({
  items: z.array(mediaItemSchema).max(100, '单次同步记录数不能超过 100 条'),
});
