// 职业配置。来源：规则手册 3.2 职业技能表。
// v0.1 仅作展示与选择，技能不自动触发（留待 v0.2）。

export interface RoleConfig {
  id: string;
  name: string;
  skill: string;
}

export const ROLES: RoleConfig[] = [
  {
    id: "shadow_envoy",
    name: "暗影使者",
    skill: "免疫暗影吸取生命。存活状态下，每当其他暗影吸取生命，你恢复 1 点生命。",
  },
  {
    id: "tycoon",
    name: "富豪",
    skill: "金库中的 2 张金条和大仓库中的 1 张金条归你初始所有。",
  },
  {
    id: "mercenary",
    name: "雇佣兵",
    skill: "你的武器（刀、手枪、霰弹枪）不负重。你的刀与手枪具备相同效果，武力不变。",
  },
  {
    id: "beastmaster",
    name: "驯兽师",
    skill: "武力和负重永久 +1。移动阶段可派遣巡回猎犬至距离 5 以内其他有库存的房间随机抽取 1 张道具（不可超过负重）。整局限 4 次。猎犬无法使用房间效果与捷径。",
  },
  {
    id: "hypnotist",
    name: "催眠师",
    skill: "移动阶段催眠 1 名存活玩家（含自己），强制其前往指定房间（5 步内、无视速度、不可用捷径）。整局限 4 次，每名玩家只能被催眠 1 次。",
  },
  {
    id: "hacker",
    name: "黑客",
    skill: "移动阶段秘密关闭 1 个房间功能；可执行 1 次基因库/控制室/操作室功能（3 选 1）。每种行动整局限 1 次。",
  },
  {
    id: "influencer",
    name: "意见领袖",
    skill: "你决定顺位。你有额外 N×2 张票用于毒气投票，N 为其他玩家数。",
  },
  {
    id: "bartender",
    name: "饮品师",
    skill: "果汁不占负重，果汁管中的 2 张果汁归你初始所有。果汁可对其他玩家使用，使用前可选 3 张效果卡再抽取。",
  },
  {
    id: "mortician",
    name: "入殓师",
    skill: "每当有玩家变成暗影，你的负重永久 +1。道具放入停尸间前你可随机获得 1 张，每轮最多 1 张。",
  },
  {
    id: "detective",
    name: "私家侦探",
    skill: "移动阶段可放弃移动跟踪 1 名玩家并移动到其房间。整局限 3 次，每名玩家只能被跟踪 1 次；被催眠时无法使用。",
  },
  {
    id: "prophet",
    name: "预言家",
    skill: "移动阶段可秘密做死亡预告（人数不限）。被预告者本轮变暗影时你得 2 点自由基因（公开分配）并恢复 1 点生命。整局限 6 次。你决定顺位，并有额外 N×2 张毒气票。",
  },
  {
    id: "carrier",
    name: "病毒携带者",
    skill: "同房间其他存活玩家额外扣 N 点生命（N 为其他存活玩家数）并叠加 1 层感染标记。感染者变暗影时你恢复等于其感染层数的生命。初始轮仅叠标记无伤害。",
  },
  {
    id: "philanthropist",
    name: "慈善家",
    skill: "结算阶段强制赠予其他 1 名存活玩家 1 张道具，对方须公开永久转移 1 点基因给你。每名玩家整局只能被赠予 1 次。",
  },
  {
    id: "chemist",
    name: "化学家",
    skill: "移动阶段 2 选 1：①指定 1 个已满毒气房间本轮毒气伤害 -2（最低 0）；②本轮毒气楼层伤害 +2。仅持续本轮。",
  },
];

export const ROLE_IDS = ROLES.map((r) => r.id);

export function getRole(id: string | null): RoleConfig | undefined {
  if (!id) return undefined;
  return ROLES.find((r) => r.id === id);
}
