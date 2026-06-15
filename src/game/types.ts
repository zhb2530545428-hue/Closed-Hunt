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
  /** 该提交已造成的激光室即时伤害（用于改提交时回退，避免重复扣血） */
  laserDamageApplied?: number;
  /** 暗影不投票时为 null */
  gasVoteFloor: string | null;
  /** 房间功能选择（轻量 key，如 "gene" / "control_vote10"） */
  roomAction?: string;
  /** 本轮声明使用的道具 id（药片/酒/肾上腺素等），结算时处理 */
  useItems?: string[];
  /** 火箭筒袭击目标房间 */
  rocketTargetRoom?: string;
  /** 水粮上交计划（第 2 轮起） */
  submitWater?: boolean;
  submitFood?: boolean;
  notes?: string;
  submittedAt: string;
}

export interface Player {
  id: string;
  name: string;
  seatIndex: number;
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

  isReady: boolean;
  submittedAction: PlayerRoundAction | null;
}

export interface GameLog {
  id: string;
  round: number;
  phase: GamePhase;
  visibility: "public" | "private";
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
  logs: string[];
  effects: ResolutionEffect[];
}

export interface ResolutionPreview {
  round: number;
  steps: ResolutionStep[];
  /** 确认后应用的最终房间状态（含随机结果，如酒掷骰） */
  nextRoom: GameRoom;
  generatedAt: string;
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

  /** 房间库存：roomId -> 库存 */
  roomInventories: Record<string, Inventory>;
  /** 全场已消耗道具堆 */
  consumedPile: Inventory;
  /** 停机坪累积空投 */
  airdrops: AirdropPile[];

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
