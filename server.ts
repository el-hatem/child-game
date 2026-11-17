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
    أرنب: 'هذا أرنب! الأرنب لطيف ويحب القفز والجزر.',
    أسد: 'هذا أسد! الأسد ملك الغابة الشجاع.',
    فيل: 'هذا فيل! الفيل كبير وله خرطوم طويل.',
    زرافة: 'هذه زرافة! الزرافة طويلة وتأكل أوراق الشجر.',
    قرد: 'هذا قرد! القرد مرح ويحب التسلق والموز.',
    تفاحة: 'هذه تفاحة! التفاحة حمراء ولذيذة ومفيدة.',
    موزة: 'هذه موزة! الموزة صفراء ولذيذة.',
    برتقالة: 'هذه برتقالة! البرتقالة منعشة ومليئة بالفيتامينات.',
    فراولة: 'هذه فراولة! الفراولة حمراء وحلوة.',
    عنب: 'هذا عنب! العنب حبات صغيرة لذيذة.',
    سيارة: 'هذه سيارة! السيارة تسير على الطريق.',
    حافلة: 'هذه حافلة! الحافلة الكبيرة تنقل الركاب.',
    قطار: 'هذا قطار! القطار السريع يسير على السكة.',
    طائرة: 'هذه طائرة! الطائرة تحلق عالياً في السماء.',
    سفينة: 'هذه سفينة! السفينة تبحر في البحر.',
    سعيد: 'هذا وجه سعيد ومبتسم!',
    مندهش: 'هذا وجه مندهش ومتعجب!',
    نجمة: 'هذه نجمة! النجمة تلمع في السماء.',
    مثلث: 'هذا مثلث! للمثلث ثلاثة أضلاع.',
    شمس: 'هذه شمس! الشمس تشرق وتنير الصباح.',
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
