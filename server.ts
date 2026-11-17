import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('لم يتم العثور على مفتاح GEMINI_API_KEY في إعدادات الخادم.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const ttsMemoryCache = new Map<
    string,
    { audioBase64: string; mimeType: string; spokenText: string }
  >();

  const PRESET_PHRASES: Record<string, string> = {
    أرنب: 'هذا أرنب لطيف وجميل! يحب أكل الجزر ويقفز بسرعة وخفة في الحقول الخضراء!',
    أسد: 'هذا أسد شجاع وقوي! يلقب بملك الغابة وله صوت زئير رائع ومهيب!',
    فيل: 'هذا فيل ضخم ومحبوب! لديه خرطوم طويل وأذنان كبيرتان وذاكرة قوية وذكية مثلك تماماً!',
    زرافة: 'هذه زرافة رشيقة ولطيفة! هي أطول حيوان في العالم وتصل لأوراق الأشجار العالية بسهولة!',
    قرد: 'هذا قرد مرح ونشيط! يحب أكل الموز والقفز بخفة ومرح بين أغصان الأشجار!',
    تفاحة: 'هذه تفاحة حمراء مقرمشة ولذيذة! تمنحك فيتامينات وطاقة قوية لتكون بطلاً ذكياً!',
    موزة: 'هذه موزة صفراء حلوة المذاق! غنية بالطاقة وتساعد عضلاتك وعقلك على النمو والنشاط!',
    برتقالة: 'هذه برتقالة منعشة وعصيرية! غنية بفيتامين سي وتحميك من البرد وتزيد نشاطك وحيويتك!',
    فراولة: 'هذه فراولة حمراء رائعة الجمال! طعمها حلو ولذيذ ومليئة بالفيتامينات المفيدة!',
    عنب: 'هذا عنب شهي ولذيذ! حباته الصغيرة مليئة بالماء والسكريات الطبيعية المفيدة لجسمك!',
    سيارة: 'هذه سيارة سريعة وجميلة! تسير على الطرقات بأمان وتنقلنا في نزهات ممتعة مع العائلة!',
    حافلة: 'هذه حافلة مدرسية كبيرة! تجمع الأصدقاء معاً كل صباح وتأخذهم إلى المدرسة بمرح!',
    قطار: 'هذا قطار سريع وقوي! يسير على القضبان الحديدية ويطلق صوتاً ممتعاً: توت توت!',
    طائرة: 'هذه طائرة عملاقة! تحلق عالياً في السماء فوق السحاب وتسافر بنا إلى بلاد بعيدة!',
    سفينة: 'هذه سفينة بحرية جميلة! تبحر في مياه البحر الزرقاء وتتحمل الأمواج بكل ثبات!',
    سعيد: 'هذا وجه سعيد ومبتسم! الابتسامة تملأ قلوبنا بالفرح والبهجة وتجعل كل يوم مشرقاً!',
    مندهش: 'هذا وجه مندهش ومتعجب! الفضول وحب الاستكشاف هما سر التعلم واكتشاف كل جديد!',
    نجمة: 'هذه نجمة ذهبية لامعة في السماء! وأنت النجم المتألق في كل مراحل لعبة الذاكرة!',
    مثلث: 'هذا مثلث هندسي جميل! لديه ثلاثة أضلاع وثلاث زوايا متناسقة ومميزة!',
    شمس: 'هذه الشمس الساطعة والدافئة! تشرق كل صباح لتنير العالم وتمنحنا الدفء والحياة!',
  };

  // Generate Arabic educational voice audio (WAV) for recognizing a card image
  app.post('/api/tts', async (req, res) => {
    try {
      const { itemName, categoryTitle } = req.body as {
        itemName?: string;
        categoryTitle?: string;
      };

      if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
        res.status(400).json({ error: 'اسم العنصر مطلوب لتوليد الصوت.' });
        return;
      }

      const cleanName = itemName.trim();
      const cacheKey = `${(categoryTitle || '').trim()}::${cleanName}`;
      const cached = ttsMemoryCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const ai = getAiClient();
      const spokenText =
        PRESET_PHRASES[cleanName] ||
        `هذا ${cleanName}! ركز جيداً وتعرف على ${cleanName}.`;

      // Single low-latency TTS call to conserve API quota
      const ttsResp = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: spokenText,
                speechMetadata: {
                  style: 'Warm, cheerful, clear Arabic children educator voice',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio =
        ttsResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.status(502).json({
          error: 'تعذر توليد الملف الصوتي من خدمة النطق الذكي.',
        });
        return;
      }

      const result = {
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
        spokenText,
      };
      ttsMemoryCache.set(cacheKey, result);
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'حدث خطأ أثناء توليد الصوت.';
      const isRateLimit =
        message.includes('429') ||
        message.includes('RESOURCE_EXHAUSTED') ||
        message.toLowerCase().includes('quota');
      if (isRateLimit) {
        res.status(429).json({
          error:
            'تم بلوغ الحد الأقصى للطلبات (Rate Limit). انتظر دقيقة أو حدّث المفتاح في Settings > Secrets.',
        });
        return;
      }
      const status =
        message.includes('API_KEY') || message.includes('PERMISSION_DENIED')
          ? 403
          : 500;
      res.status(status).json({ error: message });
    }
  });

  const server = http.createServer(app);

  // Real-time Arabic voice conversation via Gemini Live API (gemini-3.8-live)
  const wss = new WebSocketServer({ server, path: '/api/live' });

  wss.on('connection', async (clientWs: WebSocket) => {
    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;

    try {
      const ai = getAiClient();
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
          systemInstruction:
            'أنت المعلم الذكي في تطبيق ذاكرة ذكية للأطفال من ٣ إلى ٩ سنوات. تحدث بالعربية الواضحة البسيطة وبأسلوب دافئ ومشجع وممتع للأطفال. أجب بجمل قصيرة ومفهومة، وساعد الطفل على التعرف على الحيوانات والفواكه والمواصلات والأشكال.',
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== clientWs.OPEN) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ inputTranscript: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ outputTranscript: content.outputTranscription.text })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error: err?.message || 'حدث خطأ في الاتصال الصوتي المباشر.',
                })
              );
            }
          },
        },
      });

      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ ready: true }));
      } else {
        session.close();
        session = null;
        return;
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر بدء جلسة المحادثة الصوتية.';
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ error: msg }));
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session) return;
      try {
        const parsed = JSON.parse(raw.toString()) as {
          audio?: string;
          text?: string;
        };
        if (parsed.audio) {
          session.sendRealtimeInput({
            audio: {
              data: parsed.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (parsed.text) {
          session.sendRealtimeInput({ text: parsed.text });
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    clientWs.on('close', () => {
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
      session = null;
    });
  });

  // Serve Vite in dev mode or static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Memory server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
