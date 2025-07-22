# Favicon 设置指南

## 快速设置

### 1. 上传favicon到R2

#### 方法A：使用Cloudflare控制台上传
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **R2** > **Buckets** > `yuangs`
3. 点击 **Upload** 按钮
4. 选择 `public/favicon.svg` 文件
5. 重命名为 `favicon.ico`
6. 设置 **Custom metadata**:
   - `Content-Type`: `image/svg+xml`
   - `Cache-Control`: `public, max-age=31536000`

#### 方法B：使用脚本上传（需要配置API密钥）
```bash
cd /Users/ygs/ygs/chats
node scripts/upload-favicon.js
```

### 2. 验证favicon

上传完成后，可以通过以下URL访问：
- **公开访问地址**: `https://yuangs.r2.dev/favicon.ico`
- **通过域名访问**: `https://chats.want.biz/favicon.ico`

### 3. 浏览器缓存

- favicon.ico已设置1年缓存
- 如果更新favicon，需要清除浏览器缓存或修改文件名

## 技术实现

### 文件结构
```
public/
├── favicon.svg          # 源文件（SVG格式）
├── index.html           # 已添加favicon链接
└── management.html      # 已添加favicon链接

scripts/
└── upload-favicon.js    # 上传脚本
```

### HTML引用
已在所有HTML文件的 `<head>` 中添加：
```html
<link rel="icon" type="image/svg+xml" href="/favicon.ico" />
<link rel="alternate icon" href="/favicon.ico" />
```

### Worker.js处理
`worker.js` 中已添加favicon.ico路由处理：
- 从R2获取favicon.ico文件
- 设置正确的Content-Type和缓存头
- 支持SVG格式显示

## 自定义favicon

要更换favicon：
1. 替换 `public/favicon.svg` 文件
2. 重新上传到R2
3. 清除浏览器缓存

## 故障排除

### 常见问题
1. **favicon不显示**：检查R2中是否存在文件
2. **格式问题**：确保文件格式为SVG
3. **缓存问题**：使用Ctrl+F5强制刷新
4. **跨域问题**：R2已配置CORS，无需额外设置

### 调试命令
```bash
# 检查R2中的文件
curl -I https://yuangs.r2.dev/favicon.ico

# 测试本地favicon
curl -I http://localhost:8787/favicon.ico
```