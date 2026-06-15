# 禁闭逃杀 · 电子版 v0.1（可玩原型）

把根目录《禁闭逃杀》纸面规则做成可在网页游玩的电子桌游原型。本版本目标是**让流程跑通**：开房 → 进人 → 设置 → 6 轮（自由 / 行动 / 结算）→ 最终排名，而非追求完整自动结算。

> 规则唯一来源：`禁闭逃杀_规则手册.md`。所有规则数据已拆分到 `src/game/config/`，未写死在 UI 组件里。

## 技术栈

- Next.js 14（App Router）+ TypeScript + Tailwind CSS
- Zustand 状态管理
- localStorage 持久化 + 跨标签页 `storage` 事件同步（`src/store/storage.ts` 已预留 `StorageAdapter` 接口，便于 v0.2 接入 Supabase / Firebase 实时后端）

## 如何启动

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:3000

生产构建：`npm run build && npm start`

## 如何创建 / 加入房间

- **创建房间**：首页填写房主昵称（可勾选「开发调试模式」允许少于 9 人开始）→ 创建 → 进入大厅，生成 6 位房间码。
- **加入房间**：首页输入房间码 → 加入。

### v0.1 的本地多人模型（重要）

v0.1 没有联机后端，房间数据存在**创建它的那个浏览器**的 localStorage 里：

- **同一浏览器多标签页**：共享房间数据，通过 `storage` 事件实时同步（适合一个标签页开 `/board` 投屏、另一个开 `/play`）。
- **单机热座测试**：大厅可在同一屏直接填满 9 个座位；用「我控制的玩家 / 切换身份」按钮切换视角，即可一人跑通整局，完成验收。
- 跨浏览器 / 跨设备的真实联机留待 v0.2 后端。

## 页面

| 路由 | 说明 |
|---|---|
| `/` | 首页：创建 / 加入房间、查看规则 |
| `/rules` | 规则手册（Markdown 渲染；地图图片缺失时降级提示） |
| `/room/[code]` | 大厅：9 座位、昵称、职业、基因点、出生房间、准备、开始游戏 |
| `/room/[code]/play` | 玩家私密面板 + 本轮行动提交 |
| `/room/[code]/board` | 公共战况页 + 房主控制台 + 最终排名 |

## v0.1 已实现

- 创建 / 加入房间，6 位房间码，9 人局座位
- 昵称、职业（含随机）、基因点分配（实时校验三项之和=10）、出生房间选择、准备
- 游戏状态机：`LOBBY / FREE / ACTION / RESOLUTION / GAME_OVER`，6 轮推进
- 自由 / 行动 / 结算三阶段流程，房主控制台手动推进
- 行动提交：目标房间、房间功能选择、毒气投票、备注；校验（存活必须移动、暗影不投毒气、不可重复提交）
- 行动阶段随机生成顺位卡
- **毒气投票自动统计**（暗影不计票、已毒气楼层不再计票、并列全中），写入公开日志
- 结算阶段 8 个固定步骤卡片（毒气自动落地，其余为「待房主确认」+ 自动信息提示），全部确认后进入下一轮
- 房主控制台：推进阶段、进入下一轮、结束游戏、重置玩家提交、手动调整生命值、设暗影/存活、添加公开日志
- 公共战况页：轮次/阶段、公开生命值与状态、毒气楼层、提交进度、公开日志
- 最终排名（规则 17.3）+ 金魔方积分
- localStorage 持久化，刷新不丢游戏状态与玩家身份
- 规则全部配置化：`rooms / roles / items / floors / rounds / spawnRooms / phases / roomFunctions`
- 规则引擎已预留 `resolveCombat / resolveShadow / resolveFoodAndWater / resolveDeath / resolveRoomEffects / resolveRocket` 接口（当前返回 `manual_required` + 自动信息，不留空 TODO）

## v0.1 未实现（留到 v0.2）

- 完整战斗 / 乱斗自动结算
- 枪械压制自动结算
- 房间库存与抽卡系统
- 水粮自动扣血结算
- 暗影吸血与复活自动结算
- 火箭筒自动结算
- 职业技能逐步自动化
- 移动路径合法性检查（相邻 / 楼梯 / 廊桥 / 特殊移动）
- 交易系统（顺位卡 / 道具卡）
- 实时多人同步后端（Supabase / Firebase）

## 目录结构

```
src/
  app/                     页面与路由
    page.tsx               首页
    rules/page.tsx         规则页
    room/[roomCode]/       大厅 / play / board
  components/              UI 组件
  game/
    types.ts               核心数据类型
    config/                规则配置（唯一规则数据来源）
    engine/                规则引擎（纯函数）
  store/
    storage.ts             存储适配层（预留实时同步接口）
    useGameStore.ts        Zustand 全局状态（变更唯一入口 apply()）
```
