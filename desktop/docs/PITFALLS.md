# 踩坑记录

## 1. CSP 阻止脚本加载

### 问题

桌面端打开后空白，控制台报错：

```
Refused to load the script 'http://localhost:5173/@vite/client' because it violates the following Content Security Policy directive: "script-src 'self'"
```

### 原因

Electron 的 CSP 配置太严格，只允许加载 'self' 的脚本。

### 解决

在开发模式下放宽 CSP：

```ts
// window.ts
const csp = isDev
  ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
    // ...
  : "default-src 'self'; " +
    "script-src 'self'; " +
    // ...
```

### 教训

- 开发模式和生产模式需要不同的 CSP 配置
- Vite 开发服务器需要额外的 CSP 规则

---

## 2. 登录请求发送到错误的服务器

### 问题

桌面端登录时返回 "用户名或密码错误"

### 原因

loadCloudHost() 函数调用 /api/settings 获取云端地址，但该端点需要认证。用户还没登录，所以返回 401，导致 cloudHost 为空，登录请求被发送到本地服务器。

### 解决

将 /settings 添加到公开路径：

```ts
// app.ts
app.use(
  "/api",
  apiAuth({
    publicPaths: ["/health", "/app-version", "/settings"],
    // ...
  }),
);
```

### 教训

- 登录流程依赖的 API 不能需要认证
- 需要仔细设计公开路径

---

## 3. CORS 阻止跨域请求

### 问题

前端无法访问云端服务器的 API

### 原因

浏览器的 CORS 策略阻止了跨域请求

### 解决

使用 Vite 代理避免 CORS：

```ts
// vite.config.ts
proxy: {
  "/cloud-api/api": {
    target: "http://47.92.39.184:8787",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/cloud-api\/api/, "/api"),
  },
}
```

### 教训

- 开发模式下使用代理避免 CORS
- 生产模式下需要服务器配置 CORS

---

## 4. 头像 URL 构造错误

### 问题

头像图片无法加载

### 原因

头像 URL 是相对路径（如 /uploads/avatars/xxx.jpg），前端直接使用会请求本地服务器

### 解决

在 Vite 配置中添加 /uploads 代理：

```ts
// vite.config.ts
proxy: {
  "/uploads": {
    target: "http://47.92.39.184:8787",
    changeOrigin: true,
  },
}
```

### 教训

- 相对路径的资源需要代理
- 需要考虑开发模式和生产模式的差异

---

## 5. JSX 语法错误

### 问题

```
Unexpected token, expected ","
```

### 原因

将箭头函数从 () => ( 改为 () => { 时，忘记更新结尾的 )) 为 })

### 解决

使用立即执行函数避免语法错误：

```tsx
{(() => {
  const memberUser = users.find(u => u.id === pid);
  const avatarUrl = memberUser?.avatarUrl;
  return <Avatar name={name} avatarUrl={avatarUrl} size={28} />;
})()}
```

### 教训

- 修改 JSX 语法时要同步更新开闭括号
- 使用立即执行函数可以避免复杂的括号匹配

---

## 6. 文件被截断

### 问题

write 工具写入大文件时被截断

### 原因

write 工具对大文件有限制

### 解决

使用 edit 工具进行精确修改，而不是 write 工具替换整个文件

### 教训

- 大文件修改使用 edit 工具
- 先读取文件，再进行精确修改
