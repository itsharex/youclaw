# Chat 头像与标题管理设计

## 概述

为 Chat 列表项增加可自定义的头像和标题功能。新建 Chat 时自动分配预设渐变色头像，标题取自用户第一条消息。用户可通过更多菜单修改头像和标题。

## 需求

1. Chat 新建时关联一个预设渐变色圆形头像，随机分配
2. 标题固定为用户第一条消息（前 50 字符），用户可修改
3. 更多菜单增加"修改头像"和"修改标题"功能
4. 头像字段设计兼容未来上传本地图片（base64 存 SQLite）

## 设计决策

| 问题 | 选择 | 理由 |
|------|------|------|
| 头像风格 | 纯渐变色圆形 | 简洁优雅 |
| 色相范围 | 全色谱 8 种 | 辨识度高 |
| 头像选择器 | Popover 气泡 | 轻量，不打断操作流 |
| 标题编辑 | 行内编辑 | 最轻量，原地修改 |
| 菜单形式 | 下拉菜单 | 用户熟悉，可发现性好 |

## 数据层

### chats 表变更

新增 `avatar TEXT` 列。

```sql
ALTER TABLE chats ADD COLUMN avatar TEXT;
```

### avatar 字段格式

使用前缀约定区分类型：

- **预设渐变色**: `"gradient:0"` ~ `"gradient:7"`
- **未来自定义图片**: `"image:<base64>"` 或 `"image:<id>"` （引用单独的图片存储）

现阶段只实现 `gradient:` 前缀。

### 预设渐变色定义（8 种全色谱）

| 索引 | 色相 | 渐变 |
|------|------|------|
| 0 | 红 | `oklch(0.65 0.18 0) → oklch(0.50 0.15 40)` |
| 1 | 橙 | `oklch(0.65 0.18 30) → oklch(0.50 0.15 70)` |
| 2 | 黄 | `oklch(0.65 0.18 60) → oklch(0.50 0.15 100)` |
| 3 | 绿 | `oklch(0.65 0.15 120) → oklch(0.50 0.13 160)` |
| 4 | 青 | `oklch(0.65 0.15 180) → oklch(0.50 0.13 220)` |
| 5 | 蓝 | `oklch(0.60 0.15 240) → oklch(0.48 0.13 280)` |
| 6 | 紫 | `oklch(0.62 0.17 270) → oklch(0.48 0.15 310)` |
| 7 | 粉 | `oklch(0.62 0.17 310) → oklch(0.48 0.15 350)` |

### 新增数据库函数

- `updateChatAvatar(chatId: string, avatar: string)` — 更新头像
- `updateChatName(chatId: string, name: string)` — 更新标题
- `upsertChat` 修改：新建时随机分配 `gradient:N`

### getChats 返回值变更

新增 `avatar` 字段：

```typescript
{ chat_id, name, agent_id, channel, last_message_time, last_message, avatar }
```

## API 层

### 新增端点

```
PATCH /api/chats/:chatId
Body: { name?: string, avatar?: string }
Response: { ok: true }
```

用于修改标题和/或头像。支持单独修改或同时修改。

## 前端变更

### chat-utils.ts

```typescript
// 预设渐变色数组
export const PRESET_GRADIENTS: string[] = [
  'linear-gradient(135deg, oklch(0.65 0.18 0), oklch(0.50 0.15 40))',
  // ... 共 8 种
]

// 解析 avatar 字段为 CSS 背景
export function resolveAvatar(avatar: string | null): { type: 'gradient'; css: string } | { type: 'image'; src: string } {
  if (!avatar || avatar.startsWith('gradient:')) {
    const index = avatar ? parseInt(avatar.split(':')[1]) : 0
    return { type: 'gradient', css: PRESET_GRADIENTS[index] ?? PRESET_GRADIENTS[0] }
  }
  // 未来扩展: image 类型
  return { type: 'gradient', css: PRESET_GRADIENTS[0] }
}
```

### ChatItem 类型

```typescript
export type ChatItem = {
  chat_id: string
  name: string
  agent_id: string
  channel: string
  last_message_time: string
  last_message: string | null
  avatar: string | null  // 新增
}
```

### Chat.tsx — 更多菜单

使用 shadcn `DropdownMenu` 组件：

```
⋯ 按钮 (hover 显示)
  └─ DropdownMenu
       ├─ 修改头像 → 触发 Popover
       ├─ 修改标题 → 触发行内编辑
       ├─ ── 分隔线 ──
       └─ 删除对话 (红色)
```

### Chat.tsx — 头像选择 Popover

- 从"修改头像"菜单项触发
- 展示 8 个渐变色圆形（4×2 网格）
- 当前选中项显示白色边框
- 点击即保存，调用 `PATCH /api/chats/:chatId`
- Popover 自动关闭

### Chat.tsx — 行内标题编辑

- 从"修改标题"菜单项触发
- 标题 `<span>` 替换为 `<input>`，自动聚焦并全选
- Enter 或 blur 保存（调用 PATCH API）
- Esc 取消，恢复原标题
- 编辑状态通过 `editingChatId` state 控制

### Chat.tsx — 头像形状

头像从当前的 `rounded-[10px]`（圆角方形）改为 `rounded-full`（圆形）。

### useChatContext.tsx

新增 `updateChat` 方法：

```typescript
updateChat: (chatId: string, data: { name?: string; avatar?: string }) => Promise<void>
```

调用 API 后刷新 chatList。

### client.ts

新增 API 函数：

```typescript
export function updateChat(chatId: string, data: { name?: string; avatar?: string }) {
  return apiFetch(`/api/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify(data) })
}
```

## 涉及文件

| 层 | 文件 | 变更类型 |
|---|---|---|
| DB | `src/db/index.ts` | 新增列、新增函数、修改查询 |
| API | `src/routes/messages.ts` | 新增 PATCH 端点 |
| Router | `src/channel/router.ts` | upsertChat 时随机分配 avatar |
| 前端工具 | `web/src/lib/chat-utils.ts` | 重写 chatAvatar，新增预设色数组和解析函数 |
| 前端 API | `web/src/api/client.ts` | 新增 updateChat |
| 前端 Hook 类型 | `web/src/hooks/chatCtx.ts` | ChatContextType 新增 updateChat |
| 前端 Hook | `web/src/hooks/useChatContext.tsx` | 实现 updateChat |
| 前端 UI | `web/src/pages/Chat.tsx` | DropdownMenu、Popover、行内编辑 |
