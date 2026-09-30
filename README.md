# Lumen Status

中文、浅色 Apple 风格的 LLM / API 状态页与单管理员控制台。Node.js + TypeScript 后端、React + Vite 前端、SQLite 持久化。不依赖 Docker。

## 启动

要求 Node.js **22.13+**（内置 `node:sqlite`，推荐受支持的 Node.js LTS）。

```sh
npm install
npm run dev
```

- 公开页：<http://127.0.0.1:5173/>
- 明确标注的演示页：<http://127.0.0.1:5173/?demo=1>
- 管理后台：<http://127.0.0.1:5173/admin>
- API：<http://127.0.0.1:3001/api/status>

第一次进入后台时，在本机设置至少 12 位的管理员密码。**没有预设管理员密码**。正式数据库不会预置监控或演示数据。

可选接入 Casdoor：在服务端 `.env` 同时设置 `CASDOOR_ORIGIN`、`CASDOOR_CLIENT_ID`、`CASDOOR_CLIENT_SECRET`、`CASDOOR_REDIRECT_URI`，并在 Casdoor 应用中登记完全一致的 Authorization Code 回调地址。控制台登录页会显示 Casdoor 入口；首次使用必须用已有管理员密码完成一次性绑定，不会自动创建账号。client secret 只在服务端使用。

生产构建与启动：

```sh
npm run build
npm start
```

生产时前端与 API 由同一 Node 进程提供，默认访问 <http://127.0.0.1:3001/>。可按 `.env.example` 创建 `.env` 设置端口、数据目录与公开 Origin。开发和生产都读取 `.env`。

## 第一版功能

- 公开页整体状态、搜索、分组筛选、90 天探测成功率时间柱、24 小时 / 7 天 / 30 天指标、单服务性能曲线、服务详情、事件 / 维护记录。
- 后台目标增删改、暂停 / 恢复、立即探测；协议、模型、根地址、间隔、超时、提示词、token 上限与性能阈值独立配置。
- 模型图标优先按模型 ID、其次按服务名称自动识别，支持 OpenAI、Google、xAI、Anthropic、DeepSeek、Meta、Mistral、通义千问、Kimi、豆包、智谱、MiniMax、百度。后台「添加 / 编辑监控 → 模型图标」可手动指定或恢复自动；图标与接口协议独立，修改不清空历史、不触发额外探测。未识别的模型使用通用图标，旧监控默认自动识别。品牌 SVG 来自 MIT 许可的 `@lobehub/icons-static-svg`，随应用打包，无需外部图片请求。
- 支持 OpenAI-compatible Chat Completions / Responses、Anthropic Messages、Gemini Generate Content。
- OpenAI-compatible / Gemini Embedding、OpenAI-compatible Image、Gemini 原生图片与 Imagen `predict`。不同模型的图片参数可通过附加 JSON 覆写。
- 自定义 JSON POST 端点，记录 HTTP 成功率与总耗时；自定义端点**不执行特定业务语义校验**，不测 TTFT / 速度。
- 默认每 15 分钟真实探测，32 个最大输出 token；embedding 使用单条短输入；图片每次仅生成 1 张。图片费用与最低尺寸依模型而异，并非 token 上限能控制。
- 邮件 SMTP、JSON Webhook、Telegram；故障 / 性能下降 / 恢复订阅、测试通知与发送日志。
- 故障自动创建 / 恢复公告，可关闭；手动发布故障进展与维护计划。维护公告不会自动暂停探测。
- 站点名称、说明、默认探测间隔、持续失败阈值、数据保留期、安全密码更新。

## 指标与状态口径

| 指标              | 口径                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 成功率            | 成功探测数 / 已完成探测数，不是按持续时间计算的 SLA；未配置、无样本不显示 100%。                                                                                 |
| TTFT              | 客户端发出请求至第一个非空正文 SSE 块的等待时间（含网络开销），以正文块近似 token。忽略心跳、角色块与思考片段。                                                  |
| 输出 tokens/s     | `(上游报告正文输出 token 数 - 1) / (最后正文块到首正文块的秒数)`。这是基于 SSE 分块的有效输出速度近似值；短请求、批量 token 分块会产生波动，不是严格 TPOT 基准。 |
| P50 / P95         | 最近秩百分位数，仅统计成功请求；TTFT / 速度仅包含适用且数据可靠的样本。                                                                                          |
| 总耗时            | 从请求发出到读取并校验完整响应结束，含网络时间。                                                                                                                 |
| Embedding / Image | 成功率、总耗时 P50/P95；不展示 TTFT 或输出 tokens/s。成功必须有有效向量或图片响应结构。不会下载图片 URL 验证实际图片内容。                                       |

token usage 缺失、单块输出、有效时长为零、或思考 token 计数口径不明时，不伪造速度。Responses 排除报告的 reasoning tokens；Gemini 使用 `candidatesTokenCount`；Anthropic 使用累计输出 usage，但存在 thinking 时速度留空。Chat 有 thinking 且缺少明确口径时速度留空。统计只记录指标，不保存生成正文、向量或图片。

全站性能聚合会混合不同端点与测试条件，适合概览，**不用于模型排名**；性能图为单服务曲线。较长范围曲线降采样，但指标百分位数仍用完整样本。

状态规则：

- 成功且未超过性能阈值 → 运行正常。
- 成功但 TTFT 高于阈值、速度低于阈值或总耗时高于阈值 → 性能下降。
- 失败但持续失败时长尚未超过 60 分钟 → 异常待确认。
- 持续失败时长**严格超过** 60 分钟 → 服务故障；默认 15 分钟的采样，通常要在首次失败后约 75 分钟的新失败样本才确认。
- 成功样本立即重置连续失败时间。长时间探测缺口不被当作已确认连续失败。
- 距最近样本超过两个探测间隔（并考虑超时时间） → 暂无有效数据；过期数据不冒充健康状态。
- 已暂停目标不参与全站状态与聚合指标。全站展示启用目标中最严重的状态；没有启用目标则无有效数据。

更改模型、端点、根地址、请求输入或鉴权配置会增加指标版本，避免旧模型数据被冠以新模型名称。旧版本记录保留在数据库，但当前页面只统计当前版本。

告警在探测结束的状态变化时触发，不会每 15 分钟重复通知。性能下降 → 故障、异常 → 正常等按订阅发送；初次成功不发送恢复通知。当前未实现持久化通知队列、自动重试、告警合并或冷却策略；发送失败会留日志。

## 接入地址与协议

填写包含版本路径的**根地址**，程序在其后拼接端点，不自行追加 `/v1`：

- OpenAI-compatible：`https://your-api.example/v1` → `/chat/completions`、`/responses`、`/embeddings`、`/images/generations`。
- Anthropic：`https://your-api.example/v1` → `/messages`，使用 `x-api-key` 和 `anthropic-version`。
- Gemini：`https://your-api.example/v1beta` → `/models/{model}:streamGenerateContent?alt=sse`、`:embedContent`、`:generateContent` 或 Imagen `:predict`，使用 `x-goog-api-key`。

高级配置可设置相对路径、附加参数（递归合并）与加密的附加请求头。例如较新的兼容 Chat 服务可设 `{ "max_completion_tokens": 32 }` 替换默认 `max_tokens`；不支持 `stream_options` 的服务可设 `{ "stream_options": null }`，没有 usage 则速度留空。流式文本的 `stream` 始终开启。

请求不自动重试、不跟随重定向，避免探测量和凭据外泄。上游 HTTP 错误、SSE 内错误、缺少正常结束标记、没有正文、无效向量 / 图片结构都视为失败。公开错误使用固定分类，不回显上游原文或鉴权信息。

协议依据：[OpenAI Streaming](https://developers.openai.com/api/docs/guides/streaming-responses)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions)、[Embeddings](https://developers.openai.com/api/reference/resources/embeddings)、[Images](https://developers.openai.com/api/reference/resources/images)、[Anthropic Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Gemini Generate Content](https://ai.google.dev/api/generate-content)、[Gemini Embeddings](https://ai.google.dev/api/embeddings)。自己的中转实现可能有差异，需用实际服务验收。

## 数据与安全

默认 `data/` 存放 SQLite 数据库、WAL 和 AES-256-GCM 加密密钥。目录 / 数据库 / 密钥使用限制性权限；目录被 Git 忽略。**备份需同时保存数据库与 `encryption.key`**，丢失加密密钥无法解密上游或告警凭据。运行中的 SQLite 备份请使用 SQLite backup API 或停止进程后完整备份，不要仅复制正在写入的单个数据库文件。

管理员密码使用带随机 salt 的 scrypt；7 天 HttpOnly / SameSite=Strict 会话、CSRF 验证、登录限速、请求体限制、Helmet 与生产 CSP。更新密码会注销所有会话。API key、附加头与告警配置加密保存，后台只显示是否已配置，不回显敏感字段。

**公网开放前**：

1. 在本机初始化管理员。首次 setup 仅接受本机直连；反向代理会使远端请求看起来来自本机，因此必须先初始化再开放代理。
2. 使用 HTTPS 反向代理，并设置 `PUBLIC_ORIGIN=https://你的域名`、`COOKIE_SECURE=true`、`NODE_ENV=production`。前后端必须同源。
3. 只有确实位于可信单层代理后才设置 `TRUST_PROXY=1`；不要开放后端端口绕过代理。
4. 单实例运行一个 API / 探测进程（探测最大并发 3），用 systemd / PM2 fork 模式保障常驻。**不要 PM2 cluster 或多实例共享同一数据库运行探测器**，当前没有跨进程探测锁。
5. 监控 / 告警 URL 可访问私网（用于自有内部 API），只允许可信管理员配置。不要把管理权限授予不可信用户；本版不是多租户 SSRF 隔离平台。

不把鉴权值放进根地址、提示词、模型 ID 或附加请求体。根地址不能含 userinfo、查询参数或片段；公开页会公开接口根地址与模型身份，但不会公开 key / headers / request body。

## 验证

```sh
npm run check
npm test
npm run build
```

测试使用独立临时数据库与本机模拟上游，覆盖四种流式协议、embedding / image、SSE 分块、无 usage、提前断流、状态阈值、API 权限、CSRF、配置、凭据隔离、手动真实 HTTP 探测与 Webhook。测试不会访问正式服务或消耗付费额度。

`tests/ui-server.ts` 是隔离的本机浏览器验收实例（3012，模拟上游 3013），测试账户仅用于临时数据库，不是正式默认账户。退出测试实例时删除其临时数据库，不影响 `data/`。

首版不包含多用户 / 多状态页、批量导入、官方服务状态同步、语义质量评估、地域探测、SLA 时长计算、公开邮件订阅、预算控制、Docker 或云部署。
