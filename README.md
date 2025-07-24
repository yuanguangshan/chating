🚀 AI热点内容创作与实时协作平台

🌟 项目总览

本项目旨在打造一个高效、智能的实时聊天与内容创作平台，核心目标是赋能自媒体创作者即时获取热点、生成高质量内容，并支持团队协作与多模态AI交互。它深度集成知乎热点数据、多种AI模型（Gemini、Kimi、DeepSeek）及其工具调用能力，并通过Cloudflare的Serverless架构（Workers、Durable Objects、R2）实现全球范围内的低延迟、高可扩展性。

✨ 核心功能
1. 知乎热点智能内容创作助手

热榜获取: 通过/知乎命令，实时获取知乎热榜TOP20话题，包含标题、热度、标签等信息，帮助用户快速把握时下热点。

文章生成: 使用/知乎文章 [索引号/关键词]命令，基于指定热点话题调用AI生成一篇结构完整、内容丰富的文章，大幅降低创作门槛。

相关话题生成: 键入/知乎话题 [关键词]（或留空自动选择热门话题），利用Gemini AI生成10个创意相关话题，为内容规划提供灵感。

2. 头条内容智能生成与发布

一键发布: 在聊天室中发送包含@头条指令的文本或图片消息，系统会自动调用AI智能提取标题和正文（或图片描述），并发布到预设的头条号。

智能内容处理: 自动从用户消息中提炼适合头条平台的标题和内容，并进行格式优化，例如数字转Emoji。

后台异步处理: 内容生成和发布过程在后台通过Durable Object任务队列异步执行，不阻塞用户界面，并提供实时进度反馈。

3. 多模态AI聊天与内容理解

多模型支持: 集成Google Gemini (模型一)、DeepSeek (模型二)、Kimi (模型三)，用户可在提问时选择或指定不同AI模型进行交互。

文本解释: 右键点击聊天内容，选择"问Gemini"、"DeepSeek"或"问Kimi"，提供对任意文本内容的深度解释，AI扮演“小学老师”角色，用通俗易懂的语言、比喻和案例帮助用户理解复杂概念。

图片描述: 右键点击聊天图片，选择"Gemini读图"或"Kimi读图"，智能识别图片内容，提取文字信息并进行详细描述。

智能问答与工具调用: AI助手具备强大的函数调用能力，能根据用户问题自动调用后端工具：

金融期货数据: 获取指定期货品种的最新价格、历史日线/分钟线、期权、龙虎榜、聚合数据（如最高价、最低价、成交量等），支持自然语言查询。

财经新闻: 搜索指定关键词的最新财经新闻。

K线图绘制: 根据期货合约代码和周期（如日线），生成并上传对应的K线图。

4. 实时聊天与用户管理

WebSocket实时通信: 提供流畅的实时聊天体验，支持多用户同时在线。

用户在线状态: 实时显示在线用户列表和用户数量。

多媒体消息: 支持发送图片和音频消息。

语音输入与合成: 用户可通过语音输入发送消息或向AI提问；AI回复可选择语音合成播报。

消息历史与删除: 支持加载历史消息，并允许用户删除自己发送的消息。

用户白名单管理: 通过独立的管理页面，管理员可以添加、移除用户至指定房间的白名单，实现房间访问权限控制。

5. 自动化任务调度

Cron Trigger: 通过Cloudflare Cron Triggers定时触发多种自动化任务，例如：

每日早间问候，附带名人名言、英文金句和数学知识点。

定时生成并发布期货市场分析图表（基于实时数据）。

定时抓取并发布财经新闻。

安全网机制: 定时处理头条服务中积压的发布任务队列，确保任务最终完成。

6. 实时音视频通话 (WebRTC)

点对点通话: 支持用户之间发起实时的音视频通话功能（默认仅音频），通过WebSocket进行信令交换，利用STUN/TURN服务器建立P2P连接。

通话管理: 支持发起、接听、挂断通话。

🛠️ 技术栈

Serverless 基础设施: Cloudflare Workers, Cloudflare Durable Objects, Cloudflare R2

AI 模型: Google Gemini (gemini-2.5-pro, gemini-2.5-flash), Kimi (moonshot-v1-8k, moonshot-v1-8k-vision-preview), DeepSeek (deepseek-chat, deepseek-reasoner)

实时通信: WebSocket, WebRTC (PeerConnection, ICE, SDP)

前端: HTML5, CSS3, JavaScript (ES Modules), Marked.js (Markdown渲染), ECharts (图表渲染)

后端代理/数据服务: 自定义Flask代理 (用于头条API，以及第三方金融/新闻数据API)

核心语言: JavaScript (ESM)

🚀 快速开始
前提条件

一个Cloudflare账号。

安装并配置 Wrangler CLI (Cloudflare Workers CLI)。

Node.js (LTS 版本) 和 npm/yarn。

部署步骤

克隆项目:

Generated bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name


安装依赖:

Generated bash
npm install
# 或者 yarn install
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Bash
IGNORE_WHEN_COPYING_END

配置 wrangler.toml:

根据您的Cloudflare账号信息，配置account_id、route等。

绑定 Durable Objects:

Generated toml
# wrangler.toml
# ...

[[durable_objects.bindings]]
name = "CHAT_ROOM_DO"
class_name = "HibernatingChating2"

[[durable_objects.bindings]]
name = "TOUTIAO_SERVICE_DO"
class_name = "ToutiaoServiceDO2"

# ...
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Toml
IGNORE_WHEN_COPYING_END

配置 R2 Bucket:

Generated toml
# wrangler.toml
# ...

[[r2_buckets]]
binding = "R2_BUCKET" # 环境变量名称，Worker 中通过 env.R2_BUCKET 访问
bucket_name = "your-r2-bucket-name" # 您在 R2 创建的桶名称

# ...
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Toml
IGNORE_WHEN_COPYING_END

配置 Cron Triggers:

Generated toml
# wrangler.toml
# ...

[triggers]
crons = [
  "0 0 * * *",       # 每日问候 (UTC 00:00)
  "0 1-7,13-19 * * 1-5", # 每小时图表生成/新闻获取 (工作日特定时间)
  "*/10 1-7,13-19 * * 1-5", # 每10分钟新闻获取 (工作日特定时间)
  "*/30 * * * *", # 每30分钟处理一次头条队列
]

# ...
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Toml
IGNORE_WHEN_COPYING_END

设置环境变量:
通过Cloudflare Worker控制台或wrangler secret put <KEY_NAME>命令设置以下环境变量：

GEMINI_API_KEY: Google Gemini API Key (主)

GEMINI_API_KEY2: Google Gemini API Key (备用，用于配额耗尽回退)

GEMINI_API_KEY3: Google Gemini API Key (备用2)

KIMI_API_KEY (MOONSHOT_API_KEY): Kimi (月之暗面) API Key

DEEPSEEK_API_KEY: DeepSeek API Key

FLASK_PROXY_API_URL_TOUTIAO: 您部署的Flask代理的URL，用于头条发布等

注意: 您的Flask代理需要一个后端服务来处理与头条API的交互，这部分代码不在此开源项目内，您需要自行实现或使用现有解决方案。

ADMIN_SECRET: 管理员操作（如房间重置、用户管理）的密钥。

CRON_SECRET: 用于Worker内部和DO之间定时任务调用的密钥。

API_DOMAIN: 您Workers部署后的域名，例如 chat.want.biz (用于管理页面)。

示例 (wrangler.toml):

Generated toml
# wrangler.toml
# ...
[vars]
FLASK_PROXY_API_URL_TOUTIAO = "https://your-flask-proxy.example.com/api/toutiao"
API_DOMAIN = "your-workers-domain.workers.dev" # 或者您的自定义域名
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Toml
IGNORE_WHEN_COPYING_END

示例 (通过 wrangler secret):

Generated bash
wrangler secret put GEMINI_API_KEY
wrangler secret put KIMI_API_KEY
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put ADMIN_SECRET
wrangler secret put CRON_SECRET
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Bash
IGNORE_WHEN_COPYING_END

部署到Cloudflare Workers:

Generated bash
wrangler deploy
IGNORE_WHEN_COPYING_START
content_copy
download
Use code with caution.
Bash
IGNORE_WHEN_COPYING_END

部署成功后，您将获得一个Worker的URL (例如 your-project.your-account.workers.dev)。

访问应用:

聊天室: 访问 https://your-workers-domain.workers.dev/your-room-name (例如 https://your-project.workers.dev/test)。

管理页面: 访问 https://your-workers-domain.workers.dev/management?secret=YOUR_ADMIN_SECRET。

💬 使用命令 (用户界面交互)
知乎热点功能

/知乎: 获取当前知乎热榜TOP20话题。

/知乎文章 [索引号]: 基于/知乎获取的热点列表中的指定话题（例如 1 或 3）生成文章。

/知乎话题 [关键词]: 基于知乎热点通过Gemini AI生成相关创意话题。支持空关键词，系统会自动选择当前热门话题作为基础。

AI 聊天与问答

@头条 [你的消息]: 将你的消息（文本或图片）发送到头条平台。

@gemini [你的问题] 或 @g [你的问题]: 使用Gemini AI模型回答你的问题。

@kimi [你的问题] 或 @k [你的问题]: 使用Kimi AI模型回答你的问题。

@deepseek [你的问题] 或 @d [你的问题]: 使用DeepSeek AI模型回答你的问题。

右键点击/长按消息: 弹出上下文菜单，可选择：

问Gemini / DeepSeek / 问Kimi: 对选中的文本进行解释。

Gemini读图 / Kimi读图: 对选中的图片进行描述。

发头条: 将该消息内容发布到头条（如果AI处理器能成功提取内容）。

复制: 复制消息文本内容。

删除: 删除你发送的消息。

语音交互

点击🎤图标: 启动语音输入，识别语音内容到输入框。

点击🎙️图标: 启动语音指令输入，例如 "模型一回答 [你的问题]"，"发送 [你的消息]" 等。

AI回复语音播报: AI的文本回复会自动进行语音合成播报。

📄 API 文档 (供开发者/管理员参考)

本项目提供了以下后端 API 接口，大部分由 HibernatingChating2 Durable Object 处理，部分由 Worker 本身处理。{roomName} 需要替换为实际的房间名，{secret} 需要替换为您的 ADMIN_SECRET。

API_DOMAIN: 请替换为您 Workers 部署后的域名，例如 chat.yourdomain.com 或 your-project.workers.dev。

1. 用户和房间管理 API

这些 API 主要用于管理房间的白名单用户。

获取房间白名单用户列表

Endpoint: https://{API_DOMAIN}/api/users/list?roomName={roomName}

Method: GET

Parameters:

roomName (string, required): 房间名称。

Description: 获取指定房间的白名单用户列表。如果房间白名单未激活，将返回空列表。

Response: {"users": ["user1", "user2"], "count": 2, "active": true/false}

添加用户到白名单

Endpoint: https://{API_DOMAIN}/api/users/add?roomName={roomName}&secret={secret}

Method: POST

Parameters:

roomName (string, required): 房间名称。

secret (string, required): 管理员密钥 (ADMIN_SECRET)。

Body (JSON): {"username": "newUser"}

Description: 将指定用户添加到房间白名单。如果房间白名单未激活，此操作将激活它。

Response: {"success": true, "user": "newUser", "action": "added", "totalUsers": 1, "active": true}

从白名单移除用户

Endpoint: https://{API_DOMAIN}/api/users/remove?roomName={roomName}&secret={secret}

Method: POST

Parameters:

roomName (string, required): 房间名称。

secret (string, required): 管理员密钥 (ADMIN_SECRET)。

Body (JSON): {"username": "userToRemove"}

Description: 将指定用户从房间白名单中移除。被移除的用户将无法再加入该房间。

Response: {"success": true, "user": "userToRemove", "action": "removed", "totalUsers": 0}

清空白名单

Endpoint: https://{API_DOMAIN}/api/users/clear?roomName={roomName}&secret={secret}

Method: POST

Parameters:

roomName (string, required): 房间名称。

secret (string, required): 管理员密钥 (ADMIN_SECRET)。

Description: 清空指定房间的整个白名单。房间将保持激活状态，但不再有允许的用户。

Response: {"success": true, "cleared": 5, "totalUsers": 0}

2. 消息历史和调试 API

这些 API 用于获取房间的消息历史和内部调试信息。

获取消息历史

Endpoint: https://{API_DOMAIN}/api/messages/history?roomName={roomName}

Method: GET

Parameters:

roomName (string, required): 房间名称。

beforeId (string, optional): 指定消息ID，获取该ID之前（更早）的消息。

limit (integer, optional): 返回消息的数量，默认为20。

Description: 分页获取房间的消息历史记录。

Response: {"messages": [...], "hasMore": true/false}

删除单条消息

Endpoint: https://{API_DOMAIN}/api/messages/delete?roomName={roomName}&id={messageId}&secret={secret}

Method: GET (注意：实际代码中为GET，但逻辑上POST/DELETE更合适)

Parameters:

roomName (string, required): 房间名称。

id (string, required): 要删除的消息的ID。

secret (string, required): 管理员密钥 (ADMIN_SECRET)。

Description: 删除指定ID的消息。

Response: {"message": "消息删除成功", "deleted": 1}

获取房间状态

Endpoint: https://{API_DOMAIN}/api/room/status?roomName={roomName}

Method: GET

Parameters:

roomName (string, required): 房间名称。

Description: 获取房间的当前状态，包括白名单用户数、活跃会话数、消息总数等。

Response: {"allowedUsers": 2, "activeSessions": 1, "isInitialized": true, "active": true, "timestamp": "..."}

获取调试日志

Endpoint: https://{API_DOMAIN}/api/debug/logs?roomName={roomName}

Method: GET

Parameters:

roomName (string, required): 房间名称。

Description: 获取该房间 Durable Object 的内部调试日志。

Response: {"logs": [...], "totalLogs": 100, "activeSessions": 1, ...}

获取活跃会话 (在线用户)

Endpoint: https://{API_DOMAIN}/api/debug/sessions?roomName={roomName}

Method: GET

Parameters:

roomName (string, required): 房间名称。

Description: 获取该房间当前活跃的 WebSocket 会话列表及详细信息。

Response: {"sessions": [...], "totalSessions": 1, "timestamp": "..."}

清空调试日志

Endpoint: https://{API_DOMAIN}/api/debug/clear?roomName={roomName}

Method: GET (注意：实际代码中为GET，但逻辑上POST/DELETE更合适)

Parameters:

roomName (string, required): 房间名称。

Description: 清空该房间 Durable Object 的内部调试日志。

Response: {"message": "Cleared 100 debug logs", "timestamp": "..."}

重置房间

Endpoint: https://{API_DOMAIN}/api/reset-room?roomName={roomName}&secret={secret}

Method: GET (注意：实际代码中为GET，但逻辑上POST/DELETE更合适)

Parameters:

roomName (string, required): 房间名称。

secret (string, required): 管理员密钥 (ADMIN_SECRET)。

Description: 重置指定房间的所有持久化状态（消息历史、白名单、调试日志），并断开所有连接。此操作不可逆，请谨慎使用。

Response: 房间已成功重置。 (纯文本)

3. AI 服务代理 API

这些 API 在 Worker 层面处理 AI 模型请求，并将结果返回给前端。

AI 文本解释 (Gemini / DeepSeek / Kimi)

Endpoint: https://{API_DOMAIN}/ai/explain

Method: POST

Body (JSON): {"text": "要解释的文本", "model": "gemini"|"deepseek"|"kimi", "roomName": "optional_room_for_logging"}

Description: 调用指定AI模型对文本进行解释。

Response: {"explanation": "解释内容"}

AI 图片描述 (Gemini / Kimi)

Endpoint: https://{API_DOMAIN}/ai-describe-image



Method: POST

Body (JSON): {"imageUrl": "图片的URL", "model": "gemini"|"kimi", "roomName": "optional_room_for_logging"}

Description: 调用指定AI视觉模型对图片进行描述。

Response: {"description": "图片描述内容"}

Kimi AI 聊天 (通过 Workers)

Endpoint: https://{API_DOMAIN}/api/ai/kimi?roomName={roomName}

Method: POST

Parameters:

roomName (string, required): 房间名称。

Body (JSON): {"query": "你的问题"}

Description: 直接向 Kimi AI 发送聊天请求并获取回复。此 API 用于管理页面的 Kimi 查询功能，也可以用于其他直接调用 Kimi 的场景。

Response: {"result": "Kimi 的回复"}

4. 文件上传 API

上传文件到 R2

Endpoint: https://{API_DOMAIN}/upload

Method: POST

Headers:

X-Filename (string, required): 原始文件名 (需URL编码)。

Content-Type (string, required): 文件的 MIME 类型 (e.g., image/jpeg, audio/webm)。

Body: 文件二进制内容。

Description: 将文件上传到配置的 Cloudflare R2 Bucket。

Response: {"url": "https://pub-your-r2-domain/path/to/uploaded-file"}

5. 金融数据 API

获取期货价格

Endpoint: https://{API_DOMAIN}/api/price?symbol={symbol}

Method: GET

Parameters:

symbol (string, required): 期货品种的中文名称 (e.g., '螺纹钢', '黄金') 或合约代码 (e.g., 'rb', 'au')。

Description: 获取指定期货品种的最新价格信息。

Response: {"symbol": "...", "name": "...", "price": "...", ...}

6. 内部 Durable Object API (仅限 ToutiaoServiceDO2)

以下 API 由 ToutiaoServiceDO2 实例提供，通常不直接从前端调用，而是由 ToutiaoServiceClient 在 Worker 或其他 Durable Object 中调用。它们是理解后台工作流程的关键。

提交任务到队列

Endpoint: http://localhost/queue (在 ToutiaoServiceDO2 内部调用时)

Method: POST

Body (JSON): {"text": "任务内容", "username": "用户", "id": "任务ID"}

Description: 添加一个头条内容生成和发布任务到队列。

Response: {"queueLength": 1}

立即处理任务 (不入队)

Endpoint: http://localhost/task

Method: POST

Body (JSON): {"text": "任务内容", "username": "用户", "id": "任务ID"}

Description: 立即处理一个头条内容生成和发布任务。

Response: {"success": true, "taskId": "...", "title": "...", ...}

处理队列中的所有任务

Endpoint: http://localhost/queue

Method: DELETE

Description: 触发处理队列中所有待处理的头条任务。

Response: {"results": [...]} (每个任务的处理结果数组)

获取队列状态

Endpoint: http://localhost/queue

Method: GET

Description: 获取当前头条任务队列的长度和内容。

Response: {"length": 0, "tasks": [], "lastProcessedAt": null}

获取服务统计信息

Endpoint: http://localhost/stats

Method: GET

Description: 获取头条服务的总任务数、成功数、失败数等统计。

Response: {"totalTasks": 10, "successfulTasks": 8, "failedTasks": 2, "lastProcessedAt": "..."}

获取任务结果

Endpoint: http://localhost/results?id={taskId} 或 http://localhost/results?limit={limit}

Method: GET

Parameters:

id (string, optional): 任务ID，获取单个任务结果。

limit (integer, optional): 限制返回任务结果的数量，默认为50。

Description: 获取指定任务或所有任务的处理结果。

Response: 单个任务结果或任务结果数组。

清理旧任务结果

Endpoint: http://localhost/cleanup?days={days}

Method: POST

Parameters:

days (integer, optional): 保留天数，默认为7天。

Description: 清理N天之前的任务处理结果。

Response: {"cleaned": 10} (清理的数量)

💡 项目亮点

极致的全球化与可扩展性: 借助Cloudflare Workers和Durable Objects，项目能够以极低的延迟在全球范围内提供服务，并轻松扩展到数百万用户和房间，而无需关心复杂的服务器管理。

AI驱动的创新内容创作工作流:

"知乎热点-AI话题-AI文章" 创作闭环: 从热点发现到文章落地，提供一站式智能辅助，显著提升自媒体创作效率。

智能工具链: AI能够无缝调用金融期货查询、新闻获取、图表绘制等专业工具，实现"AI+领域知识"的深度融合，提供超越传统聊天机器人的价值。

多模态交互: 支持文本、图片、语音等多模态输入输出，提供更自然、更丰富的用户体验。

高度模块化与解耦: 核心功能（聊天、头条服务）被封装在独立的Durable Objects中，提高了系统的内聚性、可维护性和弹性。即使某个服务DO出现问题，也不会影响其他DO的运行。

实时与持久化完美结合: Durable Objects独特的状态持久化能力，使得实时聊天的消息历史、在线用户列表等数据能够被安全存储，并能在DO休眠/唤醒时无缝恢复。

前端用户体验优化: 采用纯JavaScript实现高性能UI，结合Markdown渲染、语音交互、图片预览、自动滚屏等功能，提供现代化的、流畅的聊天体验。

运维友好与智能化: 内置了详细的调试日志系统、管理员控制面板和自动化定时任务（如队列处理、图表生成），大大降低了项目的运维负担，并实现了部分内容的“自生成”和“自传播”。

高可用与鲁棒性: 支持AI模型API密钥轮询、请求重试、连接断开自动重连等机制，增强了系统面对外部服务波动的韧性。

🤝 贡献

我们欢迎所有形式的贡献！如果您有任何问题、建议或想提交代码，请随时：

提交一个 Issue。

提交一个 Pull Request。





📄 许可
 

本项目采用 MIT 许可证 发布。

curl -X POST https://chat.want.biz/api/toutiao/clearQueue 
curl -s https://chat.want.biz/api/toutiao/queue
curl -s https://chat.want.biz/api/toutiao/direct -X POST -H "Content-Type: application/json" -d '{"text":"测试任务提交","username":"tester"}'
curl -s https://chat.want.biz/api/toutiao/status/external_1752824358287_b7b3dkzeq
