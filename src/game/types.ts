// 《禁闭逃杀》电子版 v0.1 核心数据类型
// 注意：规则常量不在此定义，全部放在 src/game/config 下，保持规则与类型分离。

export type PlayerStatus = "alive" | "shadow";

export type GamePhase =
  | "LOBBY"
  | "SETUP"
  | "FREE"
  | "ACTION"
  | "RESOLUTION"
  | "GAME_OVER";

/** 单个玩家本轮提交的行动 */
export interface PlayerRoundAction {
  round: number;
  fromRoom: string | null;
  toRoom: string;
  path?: string[];
  /** 暗影不投票时为 null */
  gasVoteFloor: string | null;
  /** 玩家选择使用的房间功能（可选） */
  roomAction?: string;
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
  /** 道具卡 id 列表（对应 items 配置） */
  inventory: string[];
  /** 本轮顺位卡，数字越小越先行动 */
  orderCard: number | null;
  /** 暗影累计吸血量 */
  shadowDrainCount: number;
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

/** 结算步骤卡片状态。v0.1 多数结算为“待房主确认” */
export type ResolutionStatus = "manual_required" | "auto" | "confirmed";

export interface ResolutionStep {
  /** 步骤 key，对应 phases 配置中的固定顺序 */
  key: string;
  title: string;
  status: ResolutionStatus;
  /** 系统能自动判断出的信息（如毒气投票结果） */
  autoInfo: string;
  /** 主持人备注 */
  hostNotes: string;
  confirmed: boolean;
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
  /** 已被控制室解除毒气的房间 id 列表（v0.1 预留，手动维护） */
  clearedGasRooms: string[];
  publicLogs: GameLog[];
  /** 当前轮结算步骤（进入 RESOLUTION 时生成） */
  resolutionSteps: ResolutionStep[];
  /** 开发调试模式：允许少于 9 人开始 */
  devMode: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 引擎结算函数统一返回结构，方便 v0.2 逐步自动化 */
export interface ResolveResult {
  status: ResolutionStatus;
  title: string;
  autoInfo: string;
  /** 可选的公开日志消息 */
  logs?: string[];
  /** 可选的对房间的直接修改（v0.1 多数为空） */
  patch?: Partial<GameRoom>;
}
