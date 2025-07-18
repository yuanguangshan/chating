# 头条自动发文外部访问指南

## 概述

头条自动发文功能**不仅限于聊天室使用**，可以通过HTTP API从外部访问，包括Python、curl、JavaScript等任何支持HTTP请求的客户端。

## 可用的API端点

### 1. 直接内容生成
**端点**: `POST /api/toutiao/direct`
**描述**: 直接生成头条内容，无需等待队列处理

#### curl示例
```bash
curl -X POST "https://your-domain.com/api/toutiao/direct?roomName=external" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "人工智能如何改变我们的日常生活",
    "username": "external_user",
    "id": "task_12345"
  }'
```

#### Python示例
```python
import requests
import json

url = "https://your-domain.com/api/toutiao/direct"
params = {"roomName": "external"}

payload = {
    "text": "5G技术对未来社会的影响分析",
    "username": "python_bot",
    "id": f"task_{int(time.time())}"
}

response = requests.post(url, params=params, json=payload)
result = response.json()
print(json.dumps(result, ensure_ascii=False, indent=2))
```

### 2. 任务队列提交
**端点**: `POST /api/messages/toutiao`
**描述**: 将任务加入队列，适合批量处理

#### curl示例
```bash
curl -X POST "https://your-domain.com/api/messages/toutiao?roomName=external" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "数字货币市场最新动态分析",
    "username": "batch_processor",
    "id": "queue_task_001"
  }'
```

### 3. 任务状态查询
**端点**: `GET /api/toutiao/status`
**描述**: 查询已提交任务的处理状态

#### curl示例
```bash
curl "https://your-domain.com/api/toutiao/status?roomName=external&taskId=task_12345"
```

### 4. 服务状态检查
**端点**: `GET /api/room/status`
**描述**: 获取头条服务运行状态

#### curl示例
```bash
curl "https://your-domain.com/api/room/status?roomName=external"
```

## 响应格式

### 成功响应示例
```json
{
  "success": true,
  "data": {
    "title": "人工智能如何改变我们的日常生活",
    "content": "在当今快速发展的科技时代，人工智能...",
    "tags": ["人工智能", "科技", "生活"],
    "category": "科技",
    "publish_time": "2024-01-15 14:30:00"
  }
}
```

### 错误响应示例
```json
{
  "success": false,
  "error": "内容生成失败：API调用超时"
}
```

## 使用场景示例

### 1. 内容管理系统集成
```python
# 在CMS中集成头条内容生成
def generate_daily_content(topics):
    client = ToutiaoExternalClient("https://your-domain.com")
    results = []
    
    for topic in topics:
        result = client.process_direct_task(
            text=f"今日热点：{topic}",
            username="cms_system"
        )
        results.append(result)
    
    return results
```

### 2. 自动化营销工具
```python
# 定时生成营销内容
import schedule
import time

def daily_marketing_post():
    topics = ["新品发布", "优惠活动", "行业趋势"]
    client = ToutiaoExternalClient("https://your-domain.com")
    
    for topic in topics:
        content = client.process_direct_task(
            text=f"营销文案：{topic}",
            username="marketing_bot"
        )
        # 发送到社交媒体平台
        post_to_social_media(content)

schedule.every().day.at("09:00").do(daily_marketing_post)
```

### 3. 数据分析和报告
```python
# 批量生成行业报告
industries = ["金融科技", "医疗健康", "教育培训", "电子商务"]
api = SimpleToutiaoAPI("https://your-domain.com")

reports = api.batch_generate([
    f"{industry}行业2024年发展趋势报告" 
    for industry in industries
])

# 保存为PDF或发送邮件
save_reports_as_pdf(reports)
```

## 注意事项

### 1. 频率限制
- 单个IP每分钟最多100次请求
- 建议添加适当的延迟（1-2秒）避免触发限制

### 2. 参数要求
- `roomName`: 必须提供，建议使用"external"或自定义标识
- `text`: 内容主题，建议长度10-200字符
- `username`: 调用者标识，用于日志追踪
- `id`: 任务唯一标识，建议使用时间戳+随机数

### 3. 错误处理
- 网络超时：设置合理的超时时间（30-60秒）
- 服务繁忙：实现重试机制，指数退避
- 内容审核：检查返回内容是否符合平台规范

### 4. 安全性
- 使用HTTPS协议
- 考虑添加API密钥验证
- 限制来源IP地址
- 监控异常使用模式

## 部署配置

### 环境变量设置
```bash
# wrangler.toml中添加头条服务配置
[[durable_objects.bindings]]
name = "ToutiaoServiceDO"
class_name = "ToutiaoServiceDO"

[[migrations]]
tag = "v1"
new_classes = ["ToutiaoServiceDO"]
```

### 域名配置
确保你的域名已正确指向Cloudflare Worker，并且SSL证书已配置完成。

## 测试命令

### 快速测试
```bash
# 测试服务是否可用
curl -I "https://your-domain.com/api/room/status?roomName=test"

# 测试内容生成
curl -X POST "https://your-domain.com/api/toutiao/direct?roomName=test" \
  -H "Content-Type: application/json" \
  -d '{"text":"测试内容","username":"test","id":"test_001"}'
```

通过以上方式，你可以完全脱离聊天室界面，在任何支持HTTP的环境中使用头条自动发文功能。