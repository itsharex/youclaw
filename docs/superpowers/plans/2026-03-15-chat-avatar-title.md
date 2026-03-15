# Chat 头像与标题管理实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Chat 列表项增加可自定义的渐变色圆形头像和可编辑标题，通过更多菜单触发修改操作。

**Architecture:** 后端新增 `avatar` 字段（ALTER TABLE 迁移）和 PATCH 端点；前端新增预设渐变色数组、头像解析函数、Popover 头像选择器、行内标题编辑、扩展 DropdownMenu 菜单项。

**Tech Stack:** Bun + bun:sqlite（后端）、Hono（API）、React + shadcn/ui + Tailwind CSS（前端）

**Spec:** `docs/superpowers/specs/2026-03-15-chat-avatar-title-design.md`

---

## Chunk 1: 后端数据层与 API

### Task 1: 数据库迁移 — 添加 avatar 列

**Files:**
- Modify: `src/db/index.ts:126-129` (添加迁移)

- [ ] **Step 1: 添加 avatar 列迁移**

在 `initDatabase()` 函数中，在现有迁移块之后（`attachments` 迁移后面）添加：

```typescript
// 迁移：添加 chat 头像列
try { _db.exec('ALTER TABLE chats ADD COLUMN avatar TEXT') } catch {}
```

位置：`src/db/index.ts`，在第 127 行 `ALTER TABLE messages ADD COLUMN attachments TEXT` 之后。

- [ ] **Step 2: 验证迁移**

运行：`cd /Users/kevin/Work/youClaw && bun run src/db/index.ts`

如果没有报错即可。也可以通过 `bun dev` 启动后检查数据库是否有 avatar 列。

- [ ] **Step 3: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add avatar column to chats table"
```

### Task 2: 数据库 CRUD — 新增 updateChat 函数、修改 upsertChat 和 getChats

**Files:**
- Modify: `src/db/index.ts:176-197` (upsertChat, getChats, 新增 updateChatFields)

- [ ] **Step 1: 修改 upsertChat — 新建时随机分配 avatar**

将 `src/db/index.ts` 中现有的 `upsertChat` 函数替换为：

```typescript
export function upsertChat(chatId: string, agentId: string, name?: string, channel = 'web') {
  const db = getDatabase()
  // 新建时随机分配渐变色头像
  const avatar = `gradient:${Math.floor(Math.random() * 8)}`
  db.run(
    `INSERT INTO chats (chat_id, name, agent_id, channel, last_message_time, avatar)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       last_message_time = excluded.last_message_time`,
    [chatId, name ?? chatId, agentId, channel, new Date().toISOString(), avatar]
  )
}
```

- [ ] **Step 2: 修改 getChats — 返回 avatar 字段**

将 `getChats` 函数替换为：

```typescript
export function getChats(): Array<{
  chat_id: string; name: string; agent_id: string; channel: string;
  last_message_time: string; last_message: string | null; avatar: string | null
}> {
  const db = getDatabase()
  return queryAll(db, `
    SELECT c.chat_id, c.name, c.agent_id, c.channel, c.last_message_time, c.avatar,
           (SELECT m.content FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.timestamp DESC LIMIT 1) AS last_message
    FROM chats c
    ORDER BY c.last_message_time DESC
  `)
}
```

- [ ] **Step 3: 新增 updateChatFields 函数**

在 `deleteChat` 函数之前添加：

```typescript
export function updateChatFields(chatId: string, updates: { name?: string; avatar?: string }) {
  const db = getDatabase()
  const fields: string[] = []
  const values: (string | null)[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.avatar !== undefined) { fields.push('avatar = ?'); values.push(updates.avatar) }

  if (fields.length === 0) return

  values.push(chatId)
  db.run(`UPDATE chats SET ${fields.join(', ')} WHERE chat_id = ?`, values)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add avatar to upsertChat/getChats, add updateChatFields"
```

### Task 3: API 路由 — 新增 PATCH /api/chats/:chatId

**Files:**
- Modify: `src/routes/messages.ts:1-10` (imports)
- Modify: `src/routes/messages.ts:82-89` (在 DELETE 路由之前添加 PATCH 路由)

- [ ] **Step 1: 添加 import**

在 `src/routes/messages.ts` 第 5 行，将：
```typescript
import { getMessages, getChats, deleteChat } from '../db/index.ts'
```
改为：
```typescript
import { getMessages, getChats, deleteChat, updateChatFields } from '../db/index.ts'
```

- [ ] **Step 2: 添加 PATCH 路由**

在 DELETE 路由（第 82 行 `messages.delete('/chats/:chatId'`）之前添加：

```typescript
  // PATCH /api/chats/:chatId — 修改对话头像/标题
  messages.patch('/chats/:chatId', async (c) => {
    const chatId = c.req.param('chatId')
    const body = await c.req.json<{ name?: string; avatar?: string }>()
    updateChatFields(chatId, body)
    return c.json({ ok: true })
  })
```

- [ ] **Step 3: 验证 API 可用**

启动后端 `bun dev`，用 curl 测试：

```bash
curl -X PATCH http://localhost:3000/api/chats/test-id \
  -H 'Content-Type: application/json' \
  -d '{"name":"new name","avatar":"gradient:3"}'
```

预期返回 `{"ok":true}`。

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages.ts
git commit -m "feat(api): add PATCH /api/chats/:chatId for avatar/title update"
```

---

## Chunk 2: 前端数据层

### Task 4: chat-utils.ts — 预设渐变色数组和头像解析

**Files:**
- Modify: `web/src/lib/chat-utils.ts` (整个文件重写)

- [ ] **Step 1: 重写 chat-utils.ts**

将 `web/src/lib/chat-utils.ts` 整个文件替换为：

```typescript
export type ChatItem = {
  chat_id: string
  name: string
  agent_id: string
  channel: string
  last_message_time: string
  last_message: string | null
  avatar: string | null
}

/** 8 种全色谱预设渐变色 */
export const PRESET_GRADIENTS = [
  'linear-gradient(135deg, oklch(0.65 0.18 0), oklch(0.50 0.15 40))',       // 红
  'linear-gradient(135deg, oklch(0.65 0.18 30), oklch(0.50 0.15 70))',      // 橙
  'linear-gradient(135deg, oklch(0.65 0.18 60), oklch(0.50 0.15 100))',     // 黄
  'linear-gradient(135deg, oklch(0.65 0.15 120), oklch(0.50 0.13 160))',    // 绿
  'linear-gradient(135deg, oklch(0.65 0.15 180), oklch(0.50 0.13 220))',    // 青
  'linear-gradient(135deg, oklch(0.60 0.15 240), oklch(0.48 0.13 280))',    // 蓝
  'linear-gradient(135deg, oklch(0.62 0.17 270), oklch(0.48 0.15 310))',    // 紫
  'linear-gradient(135deg, oklch(0.62 0.17 310), oklch(0.48 0.15 350))',    // 粉
] as const

/** 解析 avatar 字段为 CSS background 值 */
export function resolveAvatar(avatar: string | null): string {
  if (!avatar) return PRESET_GRADIENTS[0]
  if (avatar.startsWith('gradient:')) {
    const index = parseInt(avatar.split(':')[1], 10)
    return PRESET_GRADIENTS[index] ?? PRESET_GRADIENTS[0]
  }
  // 未来扩展: image 类型
  return PRESET_GRADIENTS[0]
}

// 按日期分组对话
export function groupChatsByDate(
  chats: ChatItem[],
  labels: { today: string; yesterday: string; older: string }
): { label: string; items: ChatItem[] }[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: ChatItem[] = []
  const yesterday: ChatItem[] = []
  const older: ChatItem[] = []

  for (const chat of chats) {
    const time = new Date(chat.last_message_time).getTime()
    if (time >= todayStart) today.push(chat)
    else if (time >= yesterdayStart) yesterday.push(chat)
    else older.push(chat)
  }

  const groups: { label: string; items: ChatItem[] }[] = []
  if (today.length) groups.push({ label: labels.today, items: today })
  if (yesterday.length) groups.push({ label: labels.yesterday, items: yesterday })
  if (older.length) groups.push({ label: labels.older, items: older })
  return groups
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/chat-utils.ts
git commit -m "feat(chat-utils): replace chatAvatar with PRESET_GRADIENTS and resolveAvatar"
```

### Task 5: API client — 新增 updateChat 函数

**Files:**
- Modify: `web/src/api/client.ts:26-27` (修改 getChats 返回类型)
- Modify: `web/src/api/client.ts:36-40` (在 deleteChat 之后添加 updateChat)

- [ ] **Step 1: 修改 getChats 返回类型**

在 `web/src/api/client.ts` 中，将 `getChats` 函数的返回类型改为包含 `avatar`:

```typescript
export async function getChats() {
  return apiFetch<Array<{ chat_id: string; name: string; agent_id: string; channel: string; last_message_time: string; last_message: string | null; avatar: string | null }>>('/api/chats')
}
```

- [ ] **Step 2: 新增 updateChat 函数**

在 `deleteChat` 函数之后添加：

```typescript
// 更新对话（头像/标题）
export async function updateChat(chatId: string, data: { name?: string; avatar?: string }) {
  return apiFetch<{ ok: boolean }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(api-client): add updateChat and avatar field to getChats"
```

### Task 6: Chat context — 新增 updateChat 方法

**Files:**
- Modify: `web/src/hooks/chatCtx.ts:25` (在 deleteChat 之后添加 updateChat 类型)
- Modify: `web/src/hooks/useChatContext.tsx:3` (imports)
- Modify: `web/src/hooks/useChatContext.tsx:81-92` (在 deleteChat 之后添加 updateChat 实现)
- Modify: `web/src/hooks/useChatContext.tsx:94-111` (Provider value 新增 updateChat)

- [ ] **Step 1: 修改 chatCtx.ts 类型**

在 `web/src/hooks/chatCtx.ts` 的 `ChatContextType` 中，在 `deleteChat` 之后添加：

```typescript
  updateChat: (chatId: string, data: { name?: string; avatar?: string }) => Promise<void>
```

- [ ] **Step 2: 修改 useChatContext.tsx — imports**

在 `web/src/hooks/useChatContext.tsx` 第 3 行，将：
```typescript
import { getChats, getAgents, deleteChat as deleteChatApi, getBrowserProfiles } from '../api/client'
```
改为：
```typescript
import { getChats, getAgents, deleteChat as deleteChatApi, updateChat as updateChatApi, getBrowserProfiles } from '../api/client'
```

- [ ] **Step 3: 添加 updateChat 实现**

在 `deleteChat` 的 `useCallback` 之后（第 92 行 `}, [refreshChats, agents])` 之后），添加：

```typescript
  const updateChat = useCallback(async (chatIdToUpdate: string, data: { name?: string; avatar?: string }) => {
    await updateChatApi(chatIdToUpdate, data)
    refreshChats()
  }, [refreshChats])
```

- [ ] **Step 4: 在 Provider value 中添加 updateChat**

在 `web/src/hooks/useChatContext.tsx` 的 `ChatContext.Provider value` 中，在 `deleteChat,` 后面加上 `updateChat,`。

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/chatCtx.ts web/src/hooks/useChatContext.tsx
git commit -m "feat(chat-context): add updateChat method for avatar/title editing"
```

---

## Chunk 3: 前端 UI — shadcn Popover + Chat 列表改造

### Task 7: 安装 shadcn Popover 组件

**Files:**
- Create: `web/src/components/ui/popover.tsx` (由 shadcn CLI 生成)

- [ ] **Step 1: 安装 Popover**

```bash
cd /Users/kevin/Work/youClaw/web && bunx shadcn@latest add popover
```

- [ ] **Step 2: 验证文件生成**

确认 `web/src/components/ui/popover.tsx` 已创建。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/popover.tsx web/package.json web/bun.lock
git commit -m "feat(ui): add shadcn popover component"
```

### Task 8: Chat.tsx — 头像改圆形 + resolveAvatar 替换

**Files:**
- Modify: `web/src/pages/Chat.tsx:6` (import 改为 resolveAvatar)
- Modify: `web/src/pages/Chat.tsx:154-157` (头像渲染)

- [ ] **Step 1: 修改 import**

在 `web/src/pages/Chat.tsx` 第 6 行，将：
```typescript
import { groupChatsByDate, chatAvatar } from "@/lib/chat-utils";
```
改为：
```typescript
import { groupChatsByDate, resolveAvatar } from "@/lib/chat-utils";
```

- [ ] **Step 2: 修改头像渲染**

将第 154-157 行的头像 `<div>` 从：
```tsx
                  <div
                    className="w-9 h-9 rounded-[10px] shrink-0 mt-0.5"
                    style={{ background: chatAvatar(chat.chat_id) }}
                  />
```
改为：
```tsx
                  <div
                    className="w-9 h-9 rounded-full shrink-0 mt-0.5"
                    style={{ background: resolveAvatar(chat.avatar) }}
                  />
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Chat.tsx
git commit -m "feat(chat): use resolveAvatar with round avatar shape"
```

### Task 9: Chat.tsx — 扩展 DropdownMenu + 头像选择 Popover + 行内标题编辑

**Files:**
- Modify: `web/src/pages/Chat.tsx` (多处修改)

- [ ] **Step 1: 添加新 imports**

在 `web/src/pages/Chat.tsx` 顶部 imports 中：

1. 在 lucide-react import 中追加 `Palette, Pencil`：
```typescript
import { Plus, Search, X, MoreHorizontal, Trash2, Palette, Pencil } from "lucide-react";
```

2. 添加 Popover import：
```typescript
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
```

3. 添加 PRESET_GRADIENTS import（修改已有的 import 行）：
```typescript
import { groupChatsByDate, resolveAvatar, PRESET_GRADIENTS } from "@/lib/chat-utils";
```

4. 添加 DropdownMenuSeparator import（修改已有的 import 行）：
```typescript
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

- [ ] **Step 2: 添加编辑状态 state**

在 `Chat` 函数体内，在 `const [searchOpen, setSearchOpen] = useState(false)` 之后添加：

```typescript
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: 添加标题编辑的处理函数**

在 `handleDeleteConfirm` 函数之后添加：

```typescript
  const handleStartEditName = (chatId: string, currentName: string) => {
    setEditingChatId(chatId);
    setEditingName(currentName);
    // 下一帧聚焦 input
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const handleSaveEditName = async () => {
    if (editingChatId && editingName.trim()) {
      await chatCtx.updateChat(editingChatId, { name: editingName.trim() });
    }
    setEditingChatId(null);
  };

  const handleCancelEditName = () => {
    setEditingChatId(null);
  };
```

- [ ] **Step 4: 替换标题渲染 — 支持行内编辑**

将第 159-162 行的标题 `<span>` 从：
```tsx
                      <span className="text-[13px] font-medium truncate flex-1 text-foreground">
                        {chat.name}
                      </span>
```
改为：
```tsx
                      {editingChatId === chat.chat_id ? (
                        <input
                          ref={editInputRef}
                          className="text-[13px] font-medium flex-1 text-foreground bg-transparent border border-primary/40 rounded px-1 py-0 outline-none min-w-0"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEditName();
                            if (e.key === "Escape") handleCancelEditName();
                          }}
                          onBlur={handleSaveEditName}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-[13px] font-medium truncate flex-1 text-foreground">
                          {chat.name}
                        </span>
                      )}
```

- [ ] **Step 5: 替换 DropdownMenuContent — 添加修改头像和修改标题菜单项**

将 DropdownMenuContent 内容（第 181-193 行）从：
```tsx
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              data-testid="chat-item-delete"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(chat.chat_id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t.common.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
```
替换为：
```tsx
                          <DropdownMenuContent>
                            <Popover>
                              <PopoverTrigger asChild>
                                <DropdownMenuItem
                                  onSelect={(e) => e.preventDefault()}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Palette className="h-3.5 w-3.5 mr-2" />
                                  {t.chat.editAvatar}
                                </DropdownMenuItem>
                              </PopoverTrigger>
                              <PopoverContent side="right" align="start" className="w-auto p-3">
                                <div className="grid grid-cols-4 gap-2">
                                  {PRESET_GRADIENTS.map((gradient, i) => (
                                    <button
                                      key={i}
                                      className={cn(
                                        "w-9 h-9 rounded-full transition-all",
                                        chat.avatar === `gradient:${i}` ? "ring-2 ring-white ring-offset-2 ring-offset-background" : "hover:scale-110",
                                      )}
                                      style={{ background: gradient }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        chatCtx.updateChat(chat.chat_id, { avatar: `gradient:${i}` });
                                      }}
                                    />
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditName(chat.chat_id, chat.name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              {t.chat.editTitle}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              data-testid="chat-item-delete"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(chat.chat_id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t.common.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Chat.tsx
git commit -m "feat(chat): add avatar picker popover, inline title edit, expanded menu"
```

### Task 10: i18n — 添加新翻译 key

**Files:**
- Modify: `web/src/i18n/en.ts` (chat section)
- Modify: `web/src/i18n/zh.ts` (chat section)

- [ ] **Step 1: 在 en.ts chat section 末尾添加**

在 `noBrowserProfile: 'None',` 之后添加：

```typescript
    editAvatar: 'Change Avatar',
    editTitle: 'Rename',
```

- [ ] **Step 2: 在 zh.ts chat section 末尾添加**

在 `noBrowserProfile: '不使用',` 之后添加：

```typescript
    editAvatar: '修改头像',
    editTitle: '修改标题',
```

- [ ] **Step 3: Commit**

```bash
git add web/src/i18n/en.ts web/src/i18n/zh.ts
git commit -m "feat(i18n): add editAvatar and editTitle translation keys"
```

### Task 11: 验证与清理

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd /Users/kevin/Work/youClaw && bun typecheck
```

预期：无错误。

- [ ] **Step 2: 启动前端验证 UI**

```bash
bun dev:web
```

在浏览器中验证：
1. Chat 列表头像为圆形渐变色
2. hover 显示 ⋯ 按钮，点击展开菜单有三项
3. 点击"修改头像" → Popover 展示 8 个渐变色，点击可切换
4. 点击"修改标题" → 标题变为 input，Enter 保存，Esc 取消
5. 删除功能仍然正常

- [ ] **Step 3: 最终 commit（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
