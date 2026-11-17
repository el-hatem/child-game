import { Item } from '../types';

// Zero-latency Web Audio API synthesizer + IndexedDB Blob playback + Gemini TTS + Arabic Web Speech fallback

let audioCtx: AudioContext | null = null;
let currentAudioEl: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function stopAllAudio(): void {
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.currentTime = 0;
    currentAudioEl = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function playTapChime(muted = false): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523.25, now); // C5
  osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.09); // E5

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

export function playShuffleTick(muted = false): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.11);
}

export function playWinMelody(muted = false): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  const now = ctx.currentTime;

  notes.forEach((freq, idx) => {
    const start = now + idx * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.28);
  });
}

export function playGentleRetryTone(muted = false): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(392, now); // G4
  osc.frequency.exponentialRampToValueAtTime(329.63, now + 0.16); // E4

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

export function speakArabicText(text: string, muted = false): void {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window))
    return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ar-SA';
    utterance.rate = 0.94;
    utterance.pitch = 1.08;

    const voices = window.speechSynthesis.getVoices();
    const arabicVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith('ar-sa')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
    if (arabicVoice) {
      utterance.voice = arabicVoice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Gracefully ignore if browser blocks speech
  }
}

export function playBlobOrUrl(
  source: Blob | string,
  muted = false
): Promise<void> {
  if (muted) return Promise.resolve();
  stopAllAudio();

  return new Promise((resolve) => {
    try {
      let srcUrl: string;
      if (source instanceof Blob) {
        currentObjectUrl = URL.createObjectURL(source);
        srcUrl = currentObjectUrl;
      } else {
        srcUrl = source;
      }

      const audio = new Audio(srcUrl);
      currentAudioEl = audio;
      audio.onended = () => {
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
          currentObjectUrl = null;
        }
        currentAudioEl = null;
        resolve();
      };
      audio.onerror = () => {
        currentAudioEl = null;
        resolve();
      };
      audio.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array<number>(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export function getSmartItemDescription(name: string, categoryTitle?: string): string {
  const clean = name.trim();
  const lower = clean.toLowerCase();

  // Animals
  if (lower.includes('أرنب') || lower.includes('ارنب')) {
    return 'هذا أرنب لطيف وجميل! يحب أكل الجزر ويقفز بسرعة ومرح في الحقول الخضراء!';
  }
  if (lower.includes('أسد') || lower.includes('اسد')) {
    return 'هذا أسد شجاع وقوي! يلقب بملك الغابة وله صوت زئير رائع ومهيب!';
  }
  if (lower.includes('فيل')) {
    return 'هذا فيل ضخم ومحبوب! لديه خرطوم طويل وأذنان كبيرتان وذاكرة قوية وذكية مثلك تماماً!';
  }
  if (lower.includes('زرافة') || lower.includes('زرافه')) {
    return 'هذه زرافة رشيقة ولطيفة! هي أطول حيوان في العالم وتصل لأوراق الأشجار العالية بسهولة!';
  }
  if (lower.includes('قرد')) {
    return 'هذا قرد مرح ونشيط! يحب أكل الموز والقفز بخفة بين أغصان الأشجار!';
  }
  if (lower.includes('قط') || lower.includes('هرة') || lower.includes('بسة')) {
    return 'هذه قطة أليفة وجميلة! تحب اللعب بالكرة وتصدر صوتاً ناعماً: مياو مياو!';
  }
  if (lower.includes('كلب')) {
    return 'هذا كلب وفي وشجاع! يحرس أصدقاءه ويحب الركض واللعب في الحديقة!';
  }
  if (lower.includes('عصفور') || lower.includes('طائر') || lower.includes('طير')) {
    return 'هذا عصفور مغرد رائع! يطير بجناحيه في السماء ويملأ الصباح بأجمل الألحان!';
  }
  if (lower.includes('حصان') || lower.includes('خيل')) {
    return 'هذا حصان أصيل وسريع! يعدو في البراري بكل رشاقة وقوة وجمال!';
  }
  if (lower.includes('جمل')) {
    return 'هذا جمل صبور وقوي! يسمى سفينة الصحراء ويتحمل السفر في الرمال الذهبية!';
  }

  // Fruits
  if (lower.includes('تفاح')) {
    return 'هذه تفاحة حمراء مقرمشة ولذيذة! تمنحك فيتامينات وطاقة قوية لتكون بطلاً ذكياً!';
  }
  if (lower.includes('موز')) {
    return 'هذه موزة صفراء حلوة المذاق! غنية بالطاقة وتساعد عضلاتك وعقلك على النمو والنشاط!';
  }
  if (lower.includes('برتقال')) {
    return 'هذه برتقالة منعشة وعصيرية! غنية بفيتامين سي وتحميك من البرد وتزيد نشاطك وحيويتك!';
  }
  if (lower.includes('فراول')) {
    return 'هذه فراولة حمراء رائعة الجمال! طعمها حلو ولذيذ ومليئة بالفيتامينات المفيدة!';
  }
  if (lower.includes('عنب')) {
    return 'هذا عنب شهي ولذيذ! حباته الصغيرة مليئة بالماء والسكريات الطبيعية المفيدة لجسمك!';
  }
  if (lower.includes('بطيخ')) {
    return 'هذا بطيخ صيفي منعش وحلو ولذيذ! يروي عطشنا في الأيام المشمسة والجميلة!';
  }

  // Vehicles
  if (lower.includes('سيار')) {
    return 'هذه سيارة سريعة وجميلة! تسير على الطرقات بأمان وتنقلنا في نزهات ممتعة مع العائلة!';
  }
  if (lower.includes('حافل') || lower.includes('باص')) {
    return 'هذه حافلة مدرسية كبيرة! تجمع الأصدقاء معاً كل صباح وتأخذهم إلى المدرسة بمرح!';
  }
  if (lower.includes('قطار')) {
    return 'هذا قطار سريع وقوي! يسير على القضبان الحديدية ويطلق صوتاً ممتعاً: توت توت!';
  }
  if (lower.includes('طائر') || lower.includes('طيار')) {
    return 'هذه طائرة عملاقة! تحلق عالياً في السماء فوق السحاب وتسافر بنا إلى بلاد بعيدة!';
  }
  if (lower.includes('سفين') || lower.includes('مركب') || lower.includes('قارب')) {
    return 'هذه سفينة بحرية جميلة! تبحر في مياه البحر الزرقاء وتتحمل الأمواج بكل ثبات!';
  }
  if (lower.includes('صاروخ')) {
    return 'هذا صاروخ فضائي خارق! ينطلق بسرعة مذهلة نحو النجوم والكواكب البعيدة في الفضاء!';
  }

  // Emotions & shapes
  if (lower.includes('سعيد') || lower.includes('فرح')) {
    return 'هذا وجه سعيد ومبتسم! الابتسامة تملأ قلوبنا بالفرح والبهجة وتجعل كل يوم مشرقاً!';
  }
  if (lower.includes('مندهش') || lower.includes('تعجب')) {
    return 'هذا وجه مندهش ومتعجب! الفضول وحب الاستكشاف هما سر التعلم واكتشاف كل جديد!';
  }
  if (lower.includes('نجم')) {
    return 'هذه نجمة ذهبية لامعة في السماء! وأنت النجم المتألق في كل مراحل لعبة الذاكرة!';
  }
  if (lower.includes('مثلث')) {
    return 'هذا مثلث هندسي جميل! لديه ثلاثة أضلاع وثلاث زوايا متناسقة ومميزة!';
  }
  if (lower.includes('شمس')) {
    return 'هذه الشمس الساطعة والدافئة! تشرق كل صباح لتنير العالم وتمنحنا الدفء والحياة!';
  }

  if (categoryTitle?.includes('حيوان')) {
    return `هذا ${clean}! مخلوق رائع ومحبوب يعيش في الطبيعة وله صفات مميزة وجميلة!`;
  }
  if (categoryTitle?.includes('فواكه') || categoryTitle?.includes('طعام')) {
    return `هذه ${clean}! طعام صحي ولذيذ يمد جسمك بالطاقة والنشاط والقوة!`;
  }
  if (categoryTitle?.includes('مواصل')) {
    return `هذه ${clean}! وسيلة انتقال ممتازة تساعدنا على التنقل واستكشاف العالم بسرعة!`;
  }

  return `هذا ${clean}! بطاقة مميزة ورائعة اكتشفتها بتركيزك العالي وذكائك الكبير!`;
}

export async function generateItemRecognitionAudio(
  item: Pick<Item, 'name' | 'imageUrl'>,
  categoryTitle?: string
): Promise<{ blob: Blob | null; spokenText: string }> {
  const smartText = getSmartItemDescription(item.name, categoryTitle);

  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: item.name,
        categoryTitle,
      }),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        audioBase64?: string;
        mimeType?: string;
        spokenText?: string;
      };

      if (payload.audioBase64) {
        const blob = base64ToBlob(
          payload.audioBase64,
          payload.mimeType || 'audio/wav'
        );
        return {
          blob,
          spokenText: payload.spokenText || smartText,
        };
      }
    }
  } catch {
    // If backend is not available (e.g. static Cloudflare Pages / Vercel without Node)
  }

  return {
    blob: null,
    spokenText: smartText,
  };
}

export async function playItemVoice(
  itemName: string,
  customAudio?: Blob | string | null,
  muted = false
): Promise<void> {
  if (muted) return;
  stopAllAudio();
  if (customAudio) {
    playTapChime(false);
    await playBlobOrUrl(customAudio, false);
    return;
  }
  playTapChime(false);
  speakArabicText(itemName, false);
}

export async function playEncouragement(
  fallbackSpeech: string,
  kind: 'win' | 'retry' | 'prompt',
  customAudio?: Blob | string | null,
  muted = false
): Promise<void> {
  if (muted) return;
  stopAllAudio();

  if (kind === 'win') {
    playWinMelody(false);
  } else if (kind === 'retry') {
    playGentleRetryTone(false);
  } else {
    playTapChime(false);
  }

  if (customAudio) {
    await playBlobOrUrl(customAudio, false);
  } else {
    speakArabicText(fallbackSpeech, false);
  }
}
