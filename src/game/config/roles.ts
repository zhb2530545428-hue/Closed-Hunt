// 职业配置。来源：规则手册 3.2 职业技能表。
// v0.1 仅作展示与选择，技能不自动触发（留待 v0.2）。

export interface RoleConfig {
  id: string;
  name: string;
  skill: string;
  /** 整局技能使用次数上限（不限次/被动则不填） */
  maxUses?: number;
  /** 是否拥有移动阶段主动技能（决定玩家页是否显示技能面板） */
  active?: boolean;
  /** 主动技能在 UI 上的简短提示 */
  actionHint?: string;
  /** v1.0 自动化程度：full=已自动化；partial=部分自动+房主辅助；todo=保留人工 */
  automation: "full" | "partial" | "todo";
  /** automation 非 full 时的说明（完成说明/UI 展示用） */
  note?: string;
}

export const ROLES: RoleConfig[] = [
  {
    id: "shadow_envoy",
    name: "暗影使者",
    skill: "免疫暗影吸取生命。存活状态下，每当其他暗影吸取生命，你恢复 1 点生命。",
    automation: "full",
  },
  {
    id: "tycoon",
    name: "富豪",
    skill: "金库中的 2 张金条和大仓库中的 1 张金条归你初始所有。",
    automation: "full",
  },
  {
    id: "mercenary",
    name: "雇佣兵",
    skill: "你的武器（刀、手枪、霰弹枪）不负重。你的刀与手枪具备相同效果，武力不变。",
    automation: "full",
  },
  {
    id: "beastmaster",
    name: "驯兽师",
    skill: "武力和负重永久 +1。移动阶段可派遣巡回猎犬至距离 5 以内其他有库存的房间随机抽取 1 张道具（不可超过负重）。整局限 4 次。猎犬无法使用房间效果与捷径。",
    maxUses: 4,
    active: true,
    actionHint: "派遣猎犬到 5 步内有库存的房间随机抽 1 张道具",
    automation: "full",
    note: "开局武力/负重 +1 已自动；猎犬以「当前位置」起算 5 步内（不经捷径）的有库存房间（含停机坪空投）随机抽 1 张，超重则无功而返，整局限 4 次。",
  },
  {
    id: "hypnotist",
    name: "催眠师",
    skill: "移动阶段催眠 1 名存活玩家（含自己），强制其前往指定房间（5 步内、无视速度、不可用捷径）。整局限 4 次，每名玩家只能被催眠 1 次。",
    maxUses: 4,
    active: true,
    actionHint: "催眠 1 名玩家强制前往指定房间",
    automation: "partial",
    note: "已实现：标记目标强制房间、限次、每人限 1 次、结算 +1 生命；被催眠者移动到该房间。5 步可达性以无视速度的 BFS 近似校验。",
  },
  {
    id: "hacker",
    name: "黑客",
    skill: "移动阶段秘密关闭 1 个房间功能；可执行 1 次基因库/控制室/操作室功能（3 选 1）。每种行动整局限 1 次。",
    active: true,
    actionHint: "关闭 1 个房间功能 / 远程执行基因库/控制室/操作室",
    automation: "full",
    note: "已实现：关闭房间（本轮该房间不触发效果/抽卡）、基因库(+1/+1/+1)、控制室(10 票或解毒指定房间)、操作室(重新分配基因)。每种行动整局限 1 次。",
  },
  {
    id: "influencer",
    name: "意见领袖",
    skill: "你决定顺位。你有额外 N×2 张票用于毒气投票，N 为其他玩家数。",
    automation: "full",
    note: "毒气投票额外票权已自动；「决定顺位」由房主在控制台调整顺位卡实现。",
  },
  {
    id: "bartender",
    name: "饮品师",
    skill: "果汁不占负重，果汁管中的 2 张果汁归你初始所有。果汁可对其他玩家使用，使用前可选 3 张效果卡再抽取。",
    active: true,
    actionHint: "对自己/他人使用果汁，可按瓶数分配多个目标，每瓶可先选 3 个骰面",
    automation: "full",
    note: "果汁不占负重、开局从酒窖 B601(果汁管) 得 2 张果汁、可对他人使用；使用多瓶时可分配给多个玩家，每瓶可指定 3 个效果（骰面），结算时各自在其中随机取 1。",
  },
  {
    id: "mortician",
    name: "入殓师",
    skill: "每当有玩家变成暗影，你的负重永久 +1。道具放入停尸间前你可随机获得 1 张，每轮最多 1 张。",
    automation: "full",
  },
  {
    id: "detective",
    name: "私家侦探",
    skill: "移动阶段可放弃移动跟踪 1 名玩家并移动到其房间。整局限 3 次，每名玩家只能被跟踪 1 次；被催眠时无法使用。",
    maxUses: 3,
    active: true,
    actionHint: "放弃移动，跟踪 1 名已提交的玩家到其本轮终点",
    automation: "full",
    note: "需等被跟踪者先提交本轮行动（前序顺位提交完毕）后才能跟踪；侦探移动到其终点房间，可正常触发房间效果/抽卡。每人限被跟踪 1 次，被催眠时不可用。",
  },
  {
    id: "prophet",
    name: "预言家",
    skill: "移动阶段可秘密做死亡预告（人数不限）。被预告者本轮变暗影时你得 2 点自由基因（公开分配）并恢复 1 点生命。整局限 6 次。你决定顺位，并有额外 N×2 张毒气票。",
    maxUses: 6,
    active: true,
    actionHint: "秘密对若干玩家做死亡预告",
    automation: "partial",
    note: "已实现：死亡预告标记、被预告者本轮变暗影 → 预言家 +1 生命并获得 2 点待分配基因；额外毒气票权已自动。基因点的公开分配由玩家在面板分配。",
  },
  {
    id: "carrier",
    name: "病毒携带者",
    skill: "同房间其他存活玩家额外扣 N 点生命（N 为其他存活玩家数）并叠加 1 层感染标记。感染者变暗影时你恢复等于其感染层数的生命。初始轮仅叠标记无伤害。",
    automation: "full",
  },
  {
    id: "philanthropist",
    name: "慈善家",
    skill: "结算阶段强制赠予其他 1 名存活玩家 1 张道具，对方须公开永久转移 1 点基因给你。每名玩家整局只能被赠予 1 次。",
    active: true,
    actionHint: "结算阶段赠予 1 名玩家 1 张道具，换取其 1 点基因",
    automation: "partial",
    note: "已实现：赠予道具、每人限 1 次、向慈善家转移基因。默认自动转移对方最高的非 0 基因（规则原应由对方选择，交互式选择保留 TODO）。",
  },
  {
    id: "chemist",
    name: "化学家",
    skill: "移动阶段 2 选 1：①指定 1 个已满毒气房间本轮毒气伤害 -2（最低 0）；②本轮毒气楼层伤害 +2。仅持续本轮。",
    active: true,
    actionHint: "削弱指定毒气房间 -2 或全局毒气 +2（仅本轮）",
    automation: "full",
  },
];

export const ROLE_IDS = ROLES.map((r) => r.id);

export function getRole(id: string | null | undefined): RoleConfig | undefined {
  if (!id) return undefined;
  return ROLES.find((r) => r.id === id);
}

/** 该职业整局技能次数上限（无则 Infinity） */
export function roleMaxUses(id: string | null | undefined): number {
  return getRole(id)?.maxUses ?? Infinity;
}
