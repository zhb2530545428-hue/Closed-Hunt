// 《禁闭逃杀》电子版核心数据类型。
// 规则常量全部放在 src/game/config 下，保持规则与类型分离。

export type PlayerStatus = "alive" | "shadow";

export type GamePhase =
  | "LOBBY"
  | "SETUP"
  | "FREE"
  | "ACTION"
  | "RESOLUTION"
  | "GAME_OVER";

/** 道具堆 / 房间库存：itemId -> 数量 */
export type Inventory = Record<string, number>;

/** 单个玩家本轮提交的行动（v0.2 扩展，v0.3 增加移动信息） */
export interface PlayerRoundAction {
  round: number;
  fromRoom: string | null;
  toRoom: string;
  /** 系统计算的推荐路径（含起点与终点） */
  path?: string[];
  /** 消耗步数 */
  stepsUsed?: number;
  /** 使用的特殊移动 */
  usedSpecialMove?: string[];
  /** 本轮移动/房间触发的效果说明（如「经过激光室」） */
  triggeredEffects?: string[];
  /** 暗影不投票时为 null */
  gasVoteFloor: string | null;
  /** 房间功能选择（轻量 key，如 "gene" / "control_vote10"） */
  roomAction?: string;
  /** 本轮该行动是否已在目标房间常规抽过一次卡（规则 7.5：每次行动只能抽一次） */
  hasDrawnFromRoom?: boolean;
  /** 本次抽卡所在房间 */
  drawnRoomId?: string;
  /** 本次抽到的道具 id（私密，仅本人可见；不写入公共日志） */
  privateDrawResult?: string[];
  /** 本轮已主动放弃在目标可抽卡房间抽卡（与 hasDrawnFromRoom 一起用于强制抽卡确认，v1.0.2 §3） */
  drawSkipped?: boolean;
  /** 本轮声明使用的道具 id（药片/酒/肾上腺素等），结算时处理 */
  useItems?: string[];
  /** 本轮声明的职业主动技能（移动阶段，v1.0） */
  roleSkill?: RoleSkillInput;
  /** 火箭筒袭击目标房间 */
  rocketTargetRoom?: string;
  /** 水粮上交计划（第 2 轮起） */
  submitWater?: boolean;
  submitFood?: boolean;
  notes?: string;
  submittedAt: string;
}

/** 职业主动技能声明（移动阶段提交，结算或落位时生效）。来源：规则手册 3.2。 */
export interface RoleSkillInput {
  /** 技能类型：charm/forecast/chemist_minus/chemist_plus/gift/hound/hacker_close/hacker_func/track */
  type: string;
  /** 目标玩家（催眠/跟踪/赠予/死亡预告等） */
  targetPlayerIds?: string[];
  /** 目标房间（催眠强制前往 / 化学家解毒房间 / 猎犬抽卡房间 / 黑客关闭房间） */
  targetRoom?: string;
  /** 慈善家赠出的道具 id */
  giveItemId?: string;
  /** 黑客三选一功能：gene/control/operate */
  funcChoice?: string;
  /** 饮品师果汁使用（单瓶兼容旧版）：可选的 3 个骰面（1-6），结算时在其中随机取 1 */
  diceFaces?: number[];
  /**
   * 饮品师多瓶果汁分配（规则 3.2）：使用 N 瓶果汁就有 N 个分配，每瓶独立目标 + 各自 3 骰面。
   * 长度应等于本轮使用的果汁数量；目标可重复或为不同玩家。
   */
  juiceAssignments?: { targetPlayerId: string; diceFaces?: number[] }[];
  /** 黑客操作室重新分配基因 / 操作室目标分配 */
  genes?: { force: number; speed: number; load: number };
}

export interface Player {
  id: string;
  name: string;
  seatIndex: number;
  /** 准备阶段玩家私下选择的「想要角色」（互相不可见，撞车时统一抽取，规则见 v1.0.1 §1） */
  preferredRoleId: string | null;
  /** 最终分配的角色（撞车解析后落定；开局前为 null） */
  roleId: string | null;
  hp: number;
  maxHp: number;
  force: number;
  speed: number;
  load: number;
  location: string | null;
  previousLocation: string | null;
  status: PlayerStatus;
  /** 道具卡 id 列表（玩家手牌，允许重复） */
  inventory: string[];
  /** 本轮顺位卡，数字越小越先行动 */
  orderCard: number | null;

  // —— 暗影 / 复活（规则 13） ——
  /** 暗影累计吸血量 */
  shadowDrainCount: number;
  /** 最后一次成功吸血所在房间 */
  lastDrainRoomId?: string;
  /** 下一轮开始复活 */
  reviveNextRound?: boolean;
  /** 复活保护生效的轮号（该轮免毒气、免水粮、必须移动） */
  reviveProtectedRound?: number;

  // —— 肾上腺素（规则 15.1） ——
  /** 将生效的轮号 */
  pendingAdrenalineRound?: number;
  /** 当前生效轮号：该轮速度 10、伤害最低降至 1 */
  adrenalineActiveRound?: number;
  /** 生效前的原始速度，效果结束后恢复 */
  baseSpeedBeforeAdrenaline?: number;

  /** 上一轮结束时生命值（全员暗影排名用，规则 17.4） */
  lastRoundHp?: number;

  // —— 水粮预交（v1.0.3 §7.1：本轮行动末尾预交「下一轮」水粮，下一轮结算时按此处理） ——
  /** 上一轮预交并将于本轮结算上交的水（由上一轮行动 submitWater 结转而来） */
  waterPledged?: boolean;
  /** 上一轮预交并将于本轮结算上交的粮食 */
  foodPledged?: boolean;

  // —— 职业运行时（v1.0，规则 3.2） ——
  /** 整局技能已使用次数（限次职业用） */
  roleUses?: number;
  /** 病毒携带者叠加在本玩家身上的感染层数（公示） */
  infection?: number;
  /** 已被催眠过（每人整局限 1 次） */
  charmedDone?: boolean;
  /** 已被跟踪过（每人整局限 1 次） */
  trackedDone?: boolean;
  /** 已被慈善家赠予过（每人整局限 1 次） */
  giftedDone?: boolean;
  /** 本轮被催眠强制前往的房间 */
  forcedRoom?: string | null;
  /**
   * 待处理的慈善家基因转移（v1.0.3 §1）：被赠予玩家须自行选择转出 1 点基因给该慈善家。
   * 结算阶段赠予成立时设置；玩家在面板选择基因（武力/速度/负重，须 >0）后清空。
   */
  pendingGiftFrom?: string | null;
  /** 结算阶段待恢复生命（催眠师/预言家技能产生） */
  roleHealPending?: number;
  /** 待公开分配的自由基因点（预言家技能产生） */
  pendingGenePoints?: number;
  /** 本轮被预言家死亡预告（结算变暗影时触发预言家收益） */
  forecastedBy?: string[];
  /** 多动作职业（黑客）整局已使用的行动种类：close/gene/control/operate */
  roleActionsUsed?: string[];

  isReady: boolean;
  /** 本轮是否已「结束行动」整轮锁定（不可再修改/抽卡）。每轮重置。规则见 v1.0.1 §7 */
  endedAction?: boolean;
  submittedAction: PlayerRoundAction | null;
}

export interface GameLog {
  id: string;
  round: number;
  phase: GamePhase;
  /**
   * 日志可见性（v1.0.2 §4 三层结算视图）：
   * - public：所有人可见（公开战况看板）；
   * - private：仅 playerId 本人可见（私密面板）；
   * - host：仅房主裁判视图可见（完整明细，如毒气票数）。
   */
  visibility: "public" | "private" | "host";
  playerId?: string;
  message: string;
  createdAt: string;
}

// —— 结算预览（规则 8、开发指令 3.5.2） ——

export interface ResolutionEffect {
  playerId?: string;
  roomId?: string;
  itemId?: string;
  hpChange?: number;
  statusChange?: PlayerStatus;
  reason: string;
}

export interface ResolutionStep {
  /** 步骤 key，对应固定结算顺序 */
  type: string;
  title: string;
  /** 公开日志：结算后所有玩家可见（仅规则允许公开的信息）。 */
  logs: string[];
  /** 房主裁判专属明细（如毒气票数），仅房主可见（v1.0.2 §4 C / §5）。 */
  hostLogs?: string[];
  /** 玩家私密结算信息：仅对应 playerId 本人可见（如黑客锁房间提示，v1.0.2 §4 B）。 */
  privateLogs?: Array<{ playerId: string; text: string }>;
  effects: ResolutionEffect[];
}

export interface ResolutionPreview {
  round: number;
  steps: ResolutionStep[];
  /** 确认后应用的最终房间状态（含随机结果，如酒掷骰） */
  nextRoom: GameRoom;
  generatedAt: string;
}

/** 自由阶段交易（规则 6.3）。仅可交易道具卡与顺位卡。 */
export interface Trade {
  id: string;
  round: number;
  fromPlayerId: string;
  toPlayerId: string;
  /** 发起方给出的道具 id 列表 */
  offerItems: string[];
  /** 发起方给出顺位卡 */
  offerOrderCard: boolean;
  /** 发起方索取对方的道具 id 列表（双向交易，可空） */
  requestItems: string[];
  /** 发起方索取对方顺位卡 */
  requestOrderCard: boolean;
  note?: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: string;
  resolvedAt?: string;
}

/** 一份停机坪空投 */
export interface AirdropPile {
  round: number;
  items: Inventory;
  claimed: boolean;
}

export interface GameRoom {
  id: string;
  roomCode: string;
  status: GamePhase;
  currentRound: number;
  currentPhase: GamePhase;
  hostPlayerId: string;
  players: Player[];

  /** 已产生的毒气楼层 id 列表 */
  gasFloors: string[];
  /** 已被控制室解除毒气的房间 id 列表 */
  clearedGasRooms: string[];
  /** 本轮被黑客关闭功能的房间 id 列表（不能触发房间效果/抽卡） */
  closedRooms: string[];

  /** 房间库存：roomId -> 库存 */
  roomInventories: Record<string, Inventory>;
  /** 全场已消耗道具堆 */
  consumedPile: Inventory;
  /** 停机坪累积空投 */
  airdrops: AirdropPile[];

  /** 自由阶段交易列表（含历史） */
  trades: Trade[];

  /** 当前轮结算预览（房主生成后、确认前存在） */
  resolutionPreview: ResolutionPreview | null;

  publicLogs: GameLog[];
  /** 开发调试模式：允许少于 9 人开始 */
  devMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RankEntry {
  playerId: string;
  rank: number;
  points: number;
}
