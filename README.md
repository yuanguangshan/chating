Chating - 下一代金融分析与协作平台

数据与对话交汇，智能与投研共生。 Chating 是一个集实时通讯、智能数据查询、深度数据可视化与AI辅助分析于一体的综合性期货投研平台。

Global Chat v1.0: Introduction
This is a feature-rich, real-time, multi-room chat application deployed on the Cloudflare serverless platform. It fully leverages Cloudflare's edge computing capabilities to deliver a highly scalable, low-latency, modern web application without the need to manage traditional servers.

✨ Core Project Features
Real-Time Chat: Supports multiple users sending and receiving real-time text, image, and audio messages across different rooms.
Audio/Video Calls: Implemented via WebRTC, with the server handling signaling to establish peer-to-peer audio/video connections between users.
AI-Powered Assistance:
Text Explanation: Integrates both Google Gemini and DeepSeek models to provide users with in-depth text analysis and explanations.
Image Recognition: Capable of describing image content and extracting text from images.
Data Visualization: Integrates the ECharts library, driven by scheduled tasks, to periodically generate charts and post them to the chat room.
File Sharing: Users can upload files (like images), which are stored in Cloudflare R2 and shared as links within the chat.
User & Permission Management: Features a fine-grained, whitelist-based room authorization system, complete with a management API.
Automated Tasks: Utilizes Cron Triggers for scheduled tasks, such as daily message pushes and periodic chart generation.
🌟 Unique Features & Highlights
Pure Serverless Architecture: The entire application is built on Cloudflare services, eliminating traditional backend servers for superior elasticity, scalability, and potential cost savings.
Elegant "Hibernation" State Management: The Durable Object is designed with a lazy-loading pattern. It only loads state into memory when active and automatically hibernates when idle, significantly optimizing resource utilization.
Robust Authorization Model: The "inactive by default" and "whitelist authorization" design for rooms provides a very high level of security and privacy.
Intelligent AI Model Scheduling: In src/ai.js, the application dynamically selects different DeepSeek models based on the time in Beijing. This is an advanced optimization strategy that considers both cost and performance.
Comprehensive Observability: chatroom_do.js includes a detailed debugLog system with an API for querying logs, which is crucial for debugging complex, distributed real-time systems.
High-Level Feature Integration: The project skillfully integrates multiple complex functionalities—real-time communication (WebSocket), P2P calls (WebRTC), object storage (R2), scheduled tasks (Cron), and artificial intelligence (AI APIs)—into a unified Cloudflare Workers architecture, showcasing exceptional technical integration capabilities.
🏗️ Technical Implementation & Architecture
This project serves as an excellent example of a full-stack application built on the Cloudflare ecosystem.

Loading...
Frontend: Composed of native HTML (index.html, management.html) and JavaScript located in the public directory. It communicates with the backend in real-time via WebSockets.
Backend Core - Cloudflare Workers (src/worker.js): Acts as the application's entry point and "switchboard," responsible for routing requests and handling global tasks.
State Management Core - Durable Objects (src/chatroom_do.js): The technical cornerstone of the project. Each chat room is a stateful instance that manages WebSocket sessions, persists history, and handles WebRTC signaling.
Storage - Cloudflare R2 (wrangler.toml): Serves as object storage for user-uploaded media files and generated chart images.
AI Service Integration (src/ai.js): Uses the standard fetch API to call the REST APIs of Google Gemini and DeepSeek.
Deployment & Development (package.json, wrangler.toml): Employs Cloudflare's wrangler CLI for one-click development, debugging, and deployment.
🔬 In-Depth Module Analysis
src/ai.js (AI Functionality Hub)
Multi-Model Strategy: Encapsulates calls to both DeepSeek and Google Gemini models with a dynamic selection strategy.
Prompt Engineering: Features carefully crafted prompts for text explanation and image description to achieve high-quality, structured AI output.
Multi-Modal Processing: Implements image downloading and Base64 conversion to support submitting image data to Vision APIs.
src/autoTasks.js & src/chart_generator.js (Automation)
Clear Task Scheduling: Uses a Map to associate Cron expressions with task functions, resulting in a clean and easily extensible design.
Server-Side Rendering: chart_generator.js is a major highlight, demonstrating a complete pipeline for fetching data, using ECharts for server-side rendering, uploading to R2, and posting to a chat room.
src/chatroom_do.js (Durable Object Core)
Excellent Design: This file is the heart of the project, with a clear structure and well-defined responsibilities.
Feature-Complete: Implements all core chat room functionalities, including state management, WebSocket lifecycle, a RESTful API, RPC interfaces, a heartbeat mechanism, and WebRTC signaling.
🚀 Installation and Startup Guide
1. Prerequisites
Node.js (LTS version recommended) & npm
A Cloudflare account
2. Install Dependencies
BASH
git clone https://github.com/yuanguangshan/chating.git
cd chating
npm install
3. Cloudflare Configuration
Log in to Wrangler
BASH
npx wrangler login
Configure R2 Bucket
Create an R2 bucket in your Cloudflare dashboard, then update wrangler.toml:
TOML
# wrangler.toml
[[
r2_buckets
]]
binding     = "R2_BUCKET"
bucket_name = "your-r2-bucket-name" # ✨ Change this
Configure Secrets (Optional)
For AI features and admin access, set the following secrets:
BASH
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ADMIN_SECRET
4. Local Development
BASH
npm run dev
Access the application at http://localhost:8787.

5. Deploy to Cloudflare
BASH
npm run deploy
After deployment, you must use the management panel to authorize users for any room before it becomes accessible.

6. View Real-Time Logs
BASH
npm run tail
🤝 Contributing
We welcome contributions! Please fork the repository, create a feature branch, and submit a pull request.

📜 License
This project is licensed under the MIT License.

中文
全球聊天室v1.0介绍
这是一个功能非常丰富的、部署在 Cloudflare 无服务器平台上的实时多房间聊天应用。它充分利用了 Cloudflare 的边缘计算能力，实现了一个高度可扩展、低延迟且无需管理传统服务器的现代化 Web 应用。

✨ 项目核心功能
实时聊天：支持多用户在不同房间内进行实时文本、图片、音频消息的发送和接收。
音视频通话：通过 WebRTC 实现，服务器负责信令交换，支持用户间建立点对点的音视频连接。
AI 智能辅助：
文本解释：集成 Google Gemini 和 DeepSeek 两大模型，为用户提供深度文本分析和解释。
图像识别：能够描述图片内容，并提取图片中的文字。
数据可视化：集成 ECharts 库，并通过定时任务驱动，能够定时生成图表并发送到聊天室。
文件共享：用户可以上传文件（如图片），文件存储在 Cloudflare R2 中，并在聊天中以链接形式分享。
用户与权限管理：拥有一个精细的、基于白名单的房间授权系统，并提供管理 API。
自动化任务：通过 Cron Triggers 实现定时任务，如每日消息推送和定时图表生成。
🌟 项目特色与亮点
纯粹的无服务器架构：整个应用完全构建在 Cloudflare 的服务之上，没有传统的后端服务器，具有极高的弹性、可扩展性和潜在的低成本优势。
精巧的“休眠”状态管理：Durable Object 的设计采用了懒加载模式，仅在活跃时加载状态到内存，不活跃时自动休眠，极大地优化了资源利用率。
健壮的授权模型：房间“默认未激活”和“白名单授权”的设计，为应用提供了非常高的安全性与私密性。
智能的 AI 模型调度：在 src/ai.js 中，根据北京时间动态选择不同的 DeepSeek 模型，这是一个非常高级的、考虑了成本和性能的优化策略。
全面的可观测性：chatroom_do.js 内置了详尽的 debugLog 系统，并提供了 API 进行查询，这对于调试复杂的分布式实时系统至关重要。
功能高度集成：项目巧妙地将实时通信（WebSocket）、P2P 通话（WebRTC）、对象存储（R2）、定时任务（Cron）和人工智能（AI APIs）等多种复杂功能融合在一个统一的 Cloudflare Workers 架构中，展示了极高的技术整合能力。
🏗️ 技术实现与架构
该项目是 Cloudflare 生态系统技术栈的一个绝佳范例。

前端：由 public 目录下的原生 HTML (index.html, management.html) 和 JavaScript 构成。
后端核心 - Cloudflare Workers (src/worker.js)：作为应用的入口和“总机”，负责路由请求和处理全局任务。
状态管理核心 - Durable Objects (src/chatroom_do.js)：项目的技术基石，每个聊天室是一个有状态的实例，管理 WebSocket 会话、持久化历史记录并处理 WebRTC 信令。
存储 - Cloudflare R2 (wrangler.toml)：作为对象存储，用于存放用户上传的媒体文件和生成的图表图片。
AI 服务集成 (src/ai.js)：通过标准的 fetch API 调用 Google Gemini 和 DeepSeek 的 REST API。
部署与开发 (package.json, wrangler.toml)：使用 Cloudflare 的 wrangler CLI 工具进行一键开发、调试和部署。
🔬 模块深度解析
src/ai.js (AI 功能中心)
多模型策略：封装了对 DeepSeek 和 Google Gemini 模型的调用，并包含动态选择策略。
Prompt Engineering: 为文本解释和图像描述功能设计了精细的 Prompt，以获取高质量、结构化的 AI 输出。
多模态处理：实现了图片下载和 Base64 转换，以支持向 Vision API 提交图像数据。
src/autoTasks.js & src/chart_generator.js (自动化任务)
清晰的任务调度：使用 Map 将 Cron 表达式与任务函数关联，设计清晰，易于扩展。
服务端图形渲染：chart_generator.js 是项目的一大亮点，展示了获取数据、使用 ECharts 服务端渲染、上传 R2 并发送到聊天室的完整自动化数据可视化管道。
src/chatroom_do.js (Durable Object 核心)
设计精良：该文件是整个项目的核心，代码结构清晰，职责明确。
功能完备：实现了包括状态管理、WebSocket 生命周期、RESTful API、RPC 接口、心跳机制、WebRTC 信令转发在内的所有核心聊天室功能。
🚀 安装与启动指南
1. 环境准备
Node.js (建议使用 LTS 版本) 和 npm
一个 Cloudflare 账户
2. 安装依赖
BASH
git clone https://github.com/yuanguangshan/chating.git
cd chating
npm install
3. Cloudflare 配置
登录 Wrangler
BASH
npx wrangler login
配置 R2 存储桶
在 Cloudflare 控制台创建一个 R2 存储桶，然后更新 wrangler.toml：
TOML
# wrangler.toml
[[
r2_buckets
]]
binding     = "R2_BUCKET"
bucket_name = "your-r2-bucket-name" # ✨ 修改为您自己的 R2 桶名
配置密钥 (可选)
若要使用 AI 功能和管理后台，请设置以下密钥：
BASH
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ADMIN_SECRET
4. 本地开发
BASH
npm run dev
启动后，在 http://localhost:8787 访问您的应用。

5. 部署到 Cloudflare
BASH
npm run deploy
部署成功后，为了保护隐私，所有房间默认不能访问，须进入管理后台输入房间名称并增加至少一位成员方才解锁该聊天室。

6. 查看实时日志
BASH
npm run tail
🤝 贡献
我们热烈欢迎各种形式的贡献！请 Fork 本仓库，创建您的功能分支，然后发起一个 Pull Request。

📜 许可证
本项目采用 MIT 许可证 开源。