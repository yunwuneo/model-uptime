import type { Health, Probe, PublicMonitor, StatusPage } from '../shared/types';

export function demoPage(hours: number): StatusPage {
  const now = Date.now();
  const specs = [
    ['GPT · Chat', 'OpenAI', 'openai', 'chat', 'gpt-chat', 680, 82, 'operational'],
    ['GPT · Responses', 'OpenAI', 'openai', 'responses', 'gpt-responses', 920, 65, 'operational'],
    [
      'Claude · Messages',
      'Anthropic',
      'anthropic',
      'messages',
      'claude-chat',
      1130,
      54,
      'operational',
    ],
    ['Gemini · Flash', 'Google', 'gemini', 'generate', 'gemini-flash', 380, 118, 'operational'],
    ['Text Embedding', 'OpenAI', 'openai', 'embedding', 'text-embedding', 120, 0, 'operational'],
    ['Image Generation', 'OpenAI', 'openai', 'image', 'image-generation', 16800, 0, 'degraded'],
  ] as const;
  const monitors: PublicMonitor[] = specs.map(
    ([name, group, provider, endpoint, model, ttft, tps, state], index) => {
      const text = !['embedding', 'image'].includes(endpoint);
      const samples = Math.min(hours * 4, 672);
      const series: Probe[] = Array.from({ length: samples }, (_, i) => {
        const variation = 1 + Math.sin(i * 0.7 + index) * 0.13 + Math.cos(i * 1.4) * 0.08;
        return {
          id: `sample-${index}-${i}`,
          monitorId: `demo-${index}`,
          revision: 1,
          checkedAt: now - ((samples - 1 - i) * hours * 3600000) / samples,
          success: true,
          latencyMs: (text ? ttft + 900 : ttft) * variation,
          ttftMs: text ? ttft * variation : null,
          tps: text ? tps / variation : null,
          outputTokens: text ? 32 : null,
          httpStatus: 200,
          error: null,
          tokenSource: text ? 'reported' : 'unavailable',
        };
      });
      return {
        id: `demo-${index}`,
        name,
        group,
        provider,
        endpoint,
        baseUrl: 'https://api.example.com/' + (provider === 'gemini' ? 'v1beta' : 'v1'),
        url:
          provider === 'gemini'
            ? `https://api.example.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
            : `https://api.example.com/v1/${endpoint === 'chat' ? 'chat/completions' : endpoint === 'messages' ? 'messages' : endpoint === 'embedding' ? 'embeddings' : endpoint === 'image' ? 'images/generations' : 'responses'}`,
        model,
        icon: 'auto',
        enabled: true,
        intervalSeconds: 900,
        health: state as Health,
        failureSince: null,
        latest: series.at(-1)!,
        metrics: {
          samples,
          successRate: 100,
          ttftP50: text ? ttft : null,
          ttftP95: text ? ttft * 1.24 : null,
          latencyP50: text ? ttft + 900 : ttft,
          latencyP95: text ? (ttft + 900) * 1.24 : ttft * 1.24,
          tpsP50: text ? tps : null,
          tpsP95: text ? tps * 1.2 : null,
        },
        series,
        history: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(now - (89 - i) * 86400000).toISOString().slice(0, 10),
          successRate: i === 65 && index === 2 ? 97.92 : 100,
          samples: 96,
        })),
      };
    },
  );
  return {
    site: {
      title: 'Lumen',
      description: 'API 可用性与大模型性能，实时透明。',
      downAfterSeconds: 3600,
      defaultIntervalSeconds: 900,
    },
    health: 'degraded',
    monitors,
    metrics: {
      samples: Math.min(hours * 4, 672) * 6,
      successRate: 100,
      ttftP50: 805,
      ttftP95: 1356,
      latencyP50: 1650,
      latencyP95: 17380,
      tpsP50: 73.5,
      tpsP95: 126.4,
    },
    incidents: [
      {
        id: 'demo-incident',
        title: 'Claude 渠道短时响应延迟',
        status: 'resolved',
        severity: 'minor',
        monitorId: 'demo-2',
        body: '上游响应耗时曾短时增加，目前探测已恢复正常。此事件为演示样例。',
        startedAt: now - 2 * 86400000,
        updatedAt: now - 2 * 86400000 + 2400000,
        resolvedAt: now - 2 * 86400000 + 2400000,
        scheduledEnd: null,
        automatic: false,
      },
    ],
    generatedAt: now,
    demo: true,
    worker: { alive: true, lastTick: now },
  };
}
