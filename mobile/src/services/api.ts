/**
 * REST API 服务
 * 通过 HTTP 调用桌面端 API
 */

import { useDeviceStore } from "../store/deviceStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  AgentConfig,
  Task,
  Run,
  Job,
  ChatMessage,
  MessageAttachment,
  MessageReply,
  AgentEvent,
  WorkflowDef,
} from "@ensemble/shared";

// ==================== 请求配置 ====================

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 文件上传超时（毫秒） */
const UPLOAD_TIMEOUT_MS = 60_000;

// ==================== 错误类型 ====================

/** API 错误码 */
export type ApiErrorCode =
  | "NO_CONNECTION"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

/** 结构化 API 错误 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly statusCode?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ==================== 响应类型 ====================

/** API 响应 */
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  errorCode?: ApiErrorCode;
}

/** 健康检查响应 */
export interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  deviceId?: string;
  deviceName?: string;
  os?: string;
  wsPort?: number;
}

/** Provider 配置 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Provider 测试结果 */
export interface ProviderTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
  models?: string[];
}

/** 任务创建输入 */
export interface CreateTaskInput {
  title: string;
  mode: "single" | "workflow" | "chat";
  input: unknown;
}

/** 聊天创建输入 */
export interface CreateChatInput {
  title: string;
  participantIds: string[];
  maxRounds?: number;
  prompt?: string;
}

/** 用户（创建用户-用户会话选人） */
export interface UserInfo {
  id: string;
  username: string;
  displayName?: string;
  role: string;
  avatarUrl?: string;
  /** 个性签名 */
  bio?: string;
  /** 地区 */
  region?: string;
  /** 生日 (YYYY-MM-DD) */
  birthday?: string;
  /** 职业 */
  occupation?: string;
}

/** manifest.settings 字段声明（服务端 zod：type 目前仅 text | password，新增取值时此处同步） */
export interface PluginSettingField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}

/** 候选插件投影（GET /api/users/me/plugins 行形状） */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 声明的定时任务数 */
  scheduled: number;
  /** 本用户是否已启用（且实例 active） */
  enabled: boolean;
  /** 是否保存过配置 */
  hasConfig: boolean;
  /** manifest 内嵌配置表单声明（manifest 即 UI） */
  settings?: PluginSettingField[];
}


/** 会话（企业级 IM） */
export interface Conversation {
  id: string;
  /** 会话创建者（发起方）的用户 id；direct 会话中即对方或自己，取决谁发起 */
  userId?: string;
  type: "direct" | "group";
  title?: string;
  participantIds: string[];
  runId: string;
  lastMessage?: string;
  lastMessageTs?: string;
  unread: number;
  createdAt: string;
  updatedAt: string;
  /** 会话静音 */
  muted?: boolean;
  /** 会话置顶 */
  pinned?: boolean;
  /** 群公告 */
  announcement?: string;
  /** 群全员禁言 */
  groupMuted?: boolean;
  /** 群主（用户 ID） */
  groupOwner?: string;
  /** 群管理员（用户 ID 列表） */
  groupAdmins?: string[];
}

/** 运行事件响应条目：服务端落库行的包装（seq 单调递增，jobId 用于归并到 job） */
export interface RunEventEntry {
  seq: number;
  jobId?: string;
  event: AgentEvent;
}

/** 运行事件响应 */
export interface RunEventsResponse {
  runId: string;
  events: RunEventEntry[];
  total: number;
  /** 服务端当前最大 seq（本地补拉游标可更新到该值） */
  lastSeq?: number;
}

/** 聊天消息行：服务端 v0.8.3 起带会话内单调 seq */
export type ChatMessageRow = ChatMessage & { seq?: number };

/** 技能信息 */
export interface SkillInfo {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  enabled: boolean;
}

/** 记忆摘要 */
export interface MemorySummary {
  totalEntries: number;
  recentEntries: number;
  lastFlushAt?: string;
  tokensUsed?: number;
}

// ==================== 请求参数 ====================

/** 分页参数 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

/** 运行事件查询参数 */
export interface RunEventsParams extends PaginationParams {
  jobId?: string;
  type?: string;
  /** 补拉游标：返回 seq 大于该值的事件（与服务端 afterSeq 对齐；缺省从头部返回） */
  afterSeq?: number;
}

// ==================== API 服务 ====================

class ApiService {
  /** 请求超时（毫秒） */
  private timeoutMs = DEFAULT_TIMEOUT_MS;

  /** 当前连接的桌面端 session token（Bearer 认证） */
  private apiToken: string | null = null;
  /** token 获取中（防止并发重复请求） */
  private tokenPromise: Promise<string | null> | null = null;
  /** 用户会话 token（云服务器登录；undefined = 尚未从存储加载） */
  private authToken: string | null | undefined = undefined;

  /** 用户 token 持久化 key（AsyncStorage） */
  private static readonly AUTH_TOKEN_KEY = "@ensemble/auth_token";

  /** 设置请求超时 */
  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms;
  }

  /** 获取当前连接的桌面端地址 */
  private getBaseUrl(): string | null {
    const { connectedDevice } = useDeviceStore.getState();
    if (!connectedDevice) return null;
    return `http://${connectedDevice.ip}:${connectedDevice.httpPort}`;
  }

  /** 获取请求凭据：用户会话 token 优先（云服务器），缺省回退本地桌面端 ws-token */
  private async getToken(): Promise<string | null> {
    if (this.authToken === undefined) {
      try {
        this.authToken = await AsyncStorage.getItem(ApiService.AUTH_TOKEN_KEY);
      } catch {
        this.authToken = null;
      }
    }
    if (this.authToken) return this.authToken;
    if (this.apiToken) return this.apiToken;
    if (!this.tokenPromise) {
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) return null;
      this.tokenPromise = (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          let res: Response;
          try {
            res = await fetch(`${baseUrl}/api/ws-token`, { signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) return null;
          const json = (await res.json()) as { token?: unknown } | null;
          this.apiToken = typeof json?.token === "string" ? json.token : null;
          return this.apiToken;
        } catch {
          return null;
        } finally {
          this.tokenPromise = null;
        }
      })();
    }
    return this.tokenPromise;
  }

  /** 当前请求凭据（WS 连接等场景复用） */
  async getAuthToken(): Promise<string | null> {
    return this.getToken();
  }

  /** 清除 token 缓存（桌面端重启 / 切换设备 / 服务端重置后旧 token 失效） */
  private resetToken(): void {
    this.apiToken = null;
    this.tokenPromise = null;
    // 同时清除持久化 + 内存中的用户 session token，避免用失效 token 反复重连
    this.authToken = null;
    void AsyncStorage.removeItem(ApiService.AUTH_TOKEN_KEY).catch(() => {});
  }

  /** 将 HTTP 状态码映射为用户友好的错误消息 */
  private getErrorMessage(status: number, detail?: string): string {
    const messages: Record<number, string> = {
      400: "请求参数有误，请检查输入",
      401: "认证失败，请重新连接",
      403: "没有权限执行此操作",
      404: "请求的资源不存在",
      408: "请求超时，服务器响应太慢",
      409: "操作冲突，资源可能已被修改",
      422: "输入数据验证失败，请检查参数",
      429: "请求过于频繁，请稍后再试",
      500: "服务器内部错误",
      502: "服务器网关错误",
      503: "服务器暂时不可用",
    };
    return messages[status] || detail || `请求失败 (${status})`;
  }

  /** 将异常映射为 ApiErrorCode */
  private getErrorCode(err: unknown): ApiErrorCode {
    if (err instanceof ApiError) return err.code;
    if (err instanceof DOMException && err.name === "AbortError") return "TIMEOUT";
    if (err instanceof TypeError && err.message.includes("fetch")) return "NETWORK_ERROR";
    if (err instanceof Error) {
      if (err.message.includes("timeout") || err.message.includes("timed out")) return "TIMEOUT";
      if (err.message.includes("network") || err.message.includes("Network")) return "NETWORK_ERROR";
    }
    return "UNKNOWN";
  }

  /** 发起 API 请求（含 401 自动重试：清除旧 Token → 重新获取 → 重试一次） */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
    _isRetry = false,
    _skipAuth = false,
  ): Promise<ApiResponse<T>> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return { error: "未连接到服务器", errorCode: "NO_CONNECTION" };
    }

    const controller = new AbortController();
    const timeout = timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const token = _skipAuth ? null : await this.getToken();
      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${path}`, options);

      if (!response.ok) {
        // 401：自动刷新 Token 并重试一次（对齐 box-im/V-IM）
        if (response.status === 401 && !_isRetry) {
          this.resetToken();
          clearTimeout(timer);
          return this.request<T>(method, path, body, timeoutMs, true, _skipAuth);
        }

        let detail: string | undefined;
        try {
          const errBody = await response.json();
          detail = errBody?.error?.message || errBody?.message || errBody?.error;
        } catch {
          // 响应体不是 JSON，忽略
        }

        const message = this.getErrorMessage(response.status, detail);
        return {
          error: message,
          errorCode: response.status === 404 ? "NOT_FOUND" : response.status >= 500 ? "SERVER_ERROR" : "VALIDATION_ERROR",
        };
      }

      // 解包服务器 { data: <payload> } 信封：res.data 即业务数据
      const json = await response.json();
      return { data: json.data };
    } catch (err) {
      const code = this.getErrorCode(err);
      const message =
        code === "TIMEOUT"
          ? `请求超时 (${timeout / 1000}s)，桌面端可能无响应`
          : code === "NETWORK_ERROR"
          ? "网络连接失败，请检查桌面端是否在线"
          : `请求异常: ${err instanceof Error ? err.message : String(err)}`;

      return { error: message, errorCode: code };
    } finally {
      clearTimeout(timer);
    }
  }

  // ========== Agent API ==========

  /**
   * 插件卡片动作（U1）：POST /api/users/me/plugins/<pluginId>/actions/<action>。
   * endpoint 为卡片里的相对路径（如 "/actions/vote"），此处归一化掉可选的
   * /actions 前缀后拼接（服务端路由固定为 .../actions/:action）。
   */
  async pluginCardAction(
    pluginId: string,
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const verb = endpoint.replace(/^\/+/, "").replace(/^actions\//, "");
    return this.request<Record<string, unknown>>(
      "POST",
      `/api/users/me/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(verb)}`,
      body,
    );
  }

  /** 内置 AI 助手对话（服务端不可用时页面回退本地回答） */
  async assistantChat(message: string): Promise<ApiResponse<{ reply?: string }>> {
    return this.request<{ reply?: string }>("POST", "/api/assistant/chat", { message });
  }

  // ========== 用户插件管理（R4 per-user 主权模型，「功能」页数据面） ==========

  /** 候选插件清单（含本用户启停状态与 manifest.settings 表单声明） */
  async getPlugins(): Promise<ApiResponse<PluginInfo[]>> {
    return this.request<PluginInfo[]>("GET", "/api/users/me/plugins");
  }

  /** 启用插件（幂等；超 timer 闸门等拒绝见 error） */
  async enablePlugin(id: string): Promise<ApiResponse<{ enabled: boolean }>> {
    return this.request<{ enabled: boolean }>("POST", `/api/users/me/plugins/${encodeURIComponent(id)}/enable`);
  }

  /** 禁用插件（unregister 本用户实例，其他人零感知） */
  async disablePlugin(id: string): Promise<ApiResponse<unknown>> {
    return this.request<unknown>("POST", `/api/users/me/plugins/${encodeURIComponent(id)}/disable`);
  }

  /** 读用户级插件配置 */
  async getPluginConfig(id: string): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("GET", `/api/users/me/plugins/${encodeURIComponent(id)}/config`);
  }

  /** 保存用户级插件配置（服务端热重启该实例使其生效） */
  async setPluginConfig(id: string, config: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return this.request<unknown>("PUT", `/api/users/me/plugins/${encodeURIComponent(id)}/config`, { config });
  }

  /** 获取所有 Agent */
  async getAgents(): Promise<ApiResponse<AgentConfig[]>> {
    return this.request<AgentConfig[]>("GET", "/api/agents");
  }

  /** 获取单个 Agent */
  async getAgent(id: string): Promise<ApiResponse<AgentConfig>> {
    return this.request<AgentConfig>("GET", "/api/agents/" + id);
  }

  /** 创建 Agent */
  async createAgent(agent: Partial<AgentConfig>): Promise<ApiResponse<AgentConfig>> {
    return this.request<AgentConfig>("POST", "/api/agents", agent);
  }

  /** 更新 Agent */
  async updateAgent(id: string, updates: Partial<AgentConfig>): Promise<ApiResponse<AgentConfig>> {
    return this.request<AgentConfig>("PATCH", "/api/agents/" + id, updates);
  }

  /** 删除 Agent */
  async deleteAgent(id: string): Promise<ApiResponse<void>> {
    return this.request<void>("DELETE", "/api/agents/" + id);
  }

  // ========== Provider API ==========

  /** 获取所有 Provider */
  async getProviders(): Promise<ApiResponse<ProviderConfig[]>> {
    return this.request<ProviderConfig[]>("GET", "/api/providers");
  }

  /** 创建 Provider */
  async createProvider(provider: Partial<ProviderConfig>): Promise<ApiResponse<ProviderConfig>> {
    return this.request<ProviderConfig>("POST", "/api/providers", provider);
  }

  /** 更新 Provider */
  async updateProvider(id: string, updates: Partial<ProviderConfig>): Promise<ApiResponse<ProviderConfig>> {
    return this.request<ProviderConfig>("PATCH", "/api/providers/" + id, updates);
  }

  /** 删除 Provider */
  async deleteProvider(id: string): Promise<ApiResponse<void>> {
    return this.request<void>("DELETE", "/api/providers/" + id);
  }

  /** 测试 Provider 连接 */
  async testProvider(id: string): Promise<ApiResponse<ProviderTestResult>> {
    return this.request<ProviderTestResult>("POST", "/api/providers/" + id + "/test");
  }

  // ========== Task API ==========

  /** 获取所有任务 */
  async getTasks(): Promise<ApiResponse<Task[]>> {
    return this.request<Task[]>("GET", "/api/tasks");
  }

  /** 创建任务（返回新建的 Run） */
  async createTask(task: CreateTaskInput): Promise<ApiResponse<Run>> {
    return this.request<Run>("POST", "/api/tasks", task);
  }

  /** 删除任务 */
  async deleteTask(id: string): Promise<ApiResponse<void>> {
    return this.request<void>("DELETE", "/api/tasks/" + id);
  }

  // ========== Run API ==========

  /** 获取所有运行 */
  async getRuns(): Promise<ApiResponse<Run[]>> {
    return this.request<Run[]>("GET", "/api/runs");
  }

  /** 获取运行详情 */
  async getRun(id: string): Promise<ApiResponse<Run>> {
    return this.request<Run>("GET", "/api/runs/" + id);
  }

  /** 获取运行的事件流 */
  async getRunEvents(runId: string, params?: RunEventsParams): Promise<ApiResponse<RunEventsResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.jobId) searchParams.set("jobId", params.jobId);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.afterSeq !== undefined) searchParams.set("afterSeq", String(params.afterSeq));
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    const path = `/api/runs/${runId}/events${qs ? `?${qs}` : ""}`;
    return this.request<RunEventsResponse>("GET", path);
  }

  /** 获取运行的 Job 列表 */
  async getRunJobs(runId: string): Promise<ApiResponse<Job[]>> {
    return this.request<Job[]>(`GET`, "/api/runs/" + runId + "/jobs");
  }

  /** 取消运行 */
  async cancelRun(runId: string): Promise<ApiResponse<{ cancelled: string }>> {
    return this.request<{ cancelled: string }>("POST", "/api/runs/" + runId + "/cancel");
  }

  // ========== Workflow API ==========

  /** 获取所有工作流 */
  async getWorkflows(): Promise<ApiResponse<WorkflowDef[]>> {
    return this.request<WorkflowDef[]>("GET", "/api/workflows");
  }

  /** 创建工作流 */
  async createWorkflow(workflow: Partial<WorkflowDef>): Promise<ApiResponse<WorkflowDef>> {
    return this.request<WorkflowDef>("POST", "/api/workflows", workflow);
  }

  /** 删除工作流 */
  async deleteWorkflow(id: string): Promise<ApiResponse<void>> {
    return this.request<void>("DELETE", "/api/workflows/" + id);
  }

  // ========== Chat API ==========

  /** 创建群聊任务（与桌面端 web 一致：POST /api/tasks, chat 模式；返回新建的 Run） */
  async createChat(input: CreateChatInput): Promise<ApiResponse<Run>> {
    return this.request<Run>("POST", "/api/tasks", {
      title: input.title,
      input: {
        mode: "chat",
        prompt: input.prompt ?? `群聊「${input.title}」已创建，请开始讨论。`,
        participantIds: input.participantIds,
        maxRounds: input.maxRounds ?? 10,
      },
    });
  }

  /** 获取群聊消息 */
  async getChatMessages(runId: string): Promise<ApiResponse<ChatMessageRow[]>> {
    return this.request<ChatMessageRow[]>(`GET`, "/api/chat/" + runId + "/messages");
  }

  /** 发送群聊消息（fire-and-forget，回复通过 WS 实时推送；clientMsgId 幂等防重发） */
  async sendChatMessage(runId: string, content: string, clientMsgId?: string): Promise<ApiResponse<{ sent: boolean }>> {
    return this.request<{ sent: boolean }>("POST", "/api/chat/" + runId + "/messages", clientMsgId ? { content, clientMsgId } : { content });
  }

  // ========== 用户 API ==========

  /** 用户列表（用户-用户会话选人） */
  async getUsers(): Promise<ApiResponse<UserInfo[]>> {
    return this.request<UserInfo[]>("GET", "/api/auth/users");
  }

  /** 登录（云服务器账号）——成功后持久化用户 token，后续请求自动携带。
   *  认证接口不带旧 token：残留的失效 Bearer 会让服务端直接 401（换机/重装后必现）。 */
  async login(username: string, password: string): Promise<ApiResponse<{ token: string; user: UserInfo }>> {
    const res = await this.request<{ token: string; user: UserInfo }>("POST", "/api/auth/login", { username, password }, undefined, false, true);
    if (res.data?.token) {
      this.authToken = res.data.token;
      try {
        await AsyncStorage.setItem(ApiService.AUTH_TOKEN_KEY, res.data.token);
      } catch {
        /* 存储不可用时仅内存 */
      }
    }
    return res;
  }

  /** 注册（云服务器账号）——成功后自动登录 */
  async register(username: string, password: string, displayName?: string): Promise<ApiResponse<{ token: string; user: UserInfo }>> {
    const res = await this.request<{ token: string; user: UserInfo }>("POST", "/api/auth/register", {
      username,
      password,
      ...(displayName ? { displayName } : {}),
    }, undefined, false, true);
    if (res.data?.token) {
      this.authToken = res.data.token;
      try {
        await AsyncStorage.setItem(ApiService.AUTH_TOKEN_KEY, res.data.token);
      } catch {
        /* ignore */
      }
    }
    return res;
  }

  /** 当前登录用户信息 */
  async getMe(): Promise<ApiResponse<UserInfo>> {
    return this.request<UserInfo>("GET", "/api/auth/me");
  }

  /** 更新当前用户资料 */
  async updateProfile(data: {
    displayName?: string;
    bio?: string;
    region?: string;
    birthday?: string;
    occupation?: string;
  }): Promise<ApiResponse<UserInfo>> {
    return this.request<UserInfo>("PATCH", "/api/auth/me", data);
  }

  /** 上传头像（base64） */
  async uploadAvatar(base64: string, mime: string): Promise<ApiResponse<{ url: string }>> {
    return this.request<{ url: string }>("POST", "/api/auth/avatar", { data: base64, mime });
  }

  /** 登出：服务端删除会话 + 清除本地用户 token */
  async logout(): Promise<ApiResponse<{ loggedOut: boolean }>> {
    const res = await this.request<{ loggedOut: boolean }>("POST", "/api/auth/logout");
    this.authToken = null;
    try {
      await AsyncStorage.removeItem(ApiService.AUTH_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    return res;
  }

  // ========== Conversation API（企业级会话） ==========

  /** 会话列表 */
  async getConversations(): Promise<ApiResponse<Conversation[]>> {
    return this.request<Conversation[]>("GET", "/api/conversations");
  }

  /** 创建会话（direct：单个 agent；group：多 agent） */
  async createConversation(input: {
    type: "direct" | "group";
    title?: string;
    participantIds: string[];
  }): Promise<ApiResponse<Conversation>> {
    return this.request<Conversation>("POST", "/api/conversations", input);
  }

  /** 会话消息分页（before 时间戳游标）；afterSeq 增量补拉：仅返回 seq > N（服务端 v0.8.10+ 裁剪，旧服务端忽略该参数退化为全量） */
  async getConversationMessages(
    convId: string,
    before?: string,
    limit = 50,
    afterSeq?: number,
  ): Promise<ApiResponse<{ messages: ChatMessageRow[]; total: number; readers?: Array<{ userId: string; readTs?: string }> }>> {
    const sp = new URLSearchParams();
    if (before) sp.set("before", before);
    if (afterSeq !== undefined) sp.set("afterSeq", String(afterSeq));
    sp.set("limit", String(limit));
    const qs = `?${sp.toString()}`;
    return this.request<{ messages: ChatMessageRow[]; total: number; readers?: Array<{ userId: string; readTs?: string }> }>(
      "GET",
      `/api/conversations/${convId}/messages${qs}`,
    );
  }

  /** 撤回消息（发送者可撤） */
  async recallMessage(convId: string, msgId: string): Promise<ApiResponse<{ recalled: string }>> {
    return this.request<{ recalled: string }>("DELETE", "/api/conversations/" + convId + "/messages/" + msgId);
  }

  /** 编辑消息（仅发送者可调；成功后服务端广播 chat.edited 事件） */
  async editMessage(convId: string, msgId: string, content: string): Promise<ApiResponse<{ edited: string }>> {
    return this.request<{ edited: string }>("PUT", `/api/conversations/${convId}/messages/${msgId}`, { content });
  }

  /** 发送会话消息（fire-and-forget，回复经 WS 推送） */
  /** 上传附件（base64 JSON）→ 返回可直接引用的附件元数据 */
  async uploadAttachment(input: {
    name: string;
    mime: string;
    data: string;
  }): Promise<ApiResponse<{ url: string; name: string; size: number; mime: string; type: string }>> {
    return this.request<{ url: string; name: string; size: number; mime: string; type: string }>(
      "POST",
      "/api/upload",
      input,
      UPLOAD_TIMEOUT_MS,
    );
  }

  /** 发送会话消息（fire-and-forget，回复经 WS 推送）。
   *  clientMsgId：客户端幂等 ID——重试复用同一 ID，服务端 INSERT OR IGNORE 保证不重复入库/推送。 */
  async sendConversationMessage(
    convId: string,
    content: string,
    attachment?: MessageAttachment,
    replyTo?: MessageReply,
    mentions?: string[],
    clientMsgId?: string,
  ): Promise<ApiResponse<{ sent: boolean; msgId?: string; duplicate?: boolean }>> {
    const body: Record<string, unknown> = { content };
    if (attachment) body.attachment = attachment;
    if (replyTo) body.replyTo = replyTo;
    if (mentions && mentions.length > 0) body.mentions = mentions;
    if (clientMsgId) body.clientMsgId = clientMsgId;
    return this.request<{ sent: boolean; msgId?: string; duplicate?: boolean }>(
      "POST", "/api/conversations/" + convId + "/messages", body,
    );
  }

  /** 标记会话已读 */
  async markConversationRead(convId: string): Promise<ApiResponse<{ read: boolean }>> {
    return this.request<{ read: boolean }>("POST", "/api/conversations/" + convId + "/read");
  }

  /** 静音 / 取消静音会话 */
  async muteConversation(convId: string, muted: boolean): Promise<ApiResponse<{ muted: boolean }>> {
    return this.request<{ muted: boolean }>("POST", "/api/conversations/" + convId + "/mute", { muted });
  }

  /** 置顶 / 取消置顶会话 */
  async pinConversation(convId: string, pinned: boolean): Promise<ApiResponse<{ pinned: boolean }>> {
    return this.request<{ pinned: boolean }>("POST", "/api/conversations/" + convId + "/pin", { pinned });
  }

  /** 搜索会话内消息 */
  async searchMessages(convId: string, query: string): Promise<ApiResponse<{ messages: any[]; total: number }>> {
    return this.request<{ messages: any[]; total: number }>(
      "GET",
      "/api/conversations/" + convId + "/messages/search?q=" + encodeURIComponent(query),
    );
  }

  /** 修改群信息（群名 / 成员 / 公告 / 禁言 / 管理员） */
  async updateConversation(
    convId: string,
    data: {
      title?: string;
      participantIds?: string[];
      announcement?: string;
      groupMuted?: boolean;
      groupOwner?: string;
      groupAdmins?: string[];
    },
  ): Promise<ApiResponse<{ updated: boolean }>> {
    return this.request<{ updated: boolean }>("PATCH", "/api/conversations/" + convId, data);
  }

  /** 删除会话 */
  async deleteConversation(convId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>("DELETE", "/api/conversations/" + convId);
  }

  // ========== 隐私设置 ==========
  async getPrivacy(): Promise<ApiResponse<any>> {
    return this.request<any>("GET", "/api/privacy");
  }

  async updatePrivacy(settings: Record<string, boolean>): Promise<ApiResponse<{ updated: boolean }>> {
    return this.request<{ updated: boolean }>("PATCH", "/api/privacy", settings);
  }

  async sendFriendRequest(targetId: string, message?: string): Promise<ApiResponse<{ sent: boolean }>> {
    return this.request<{ sent: boolean }>("POST", "/api/privacy/friend-request", { targetId, message });
  }

  async getFriendRequests(): Promise<ApiResponse<{ requests: any[] }>> {
    return this.request<{ requests: any[] }>("GET", "/api/privacy/friend-requests");
  }

  async getFriends(): Promise<ApiResponse<{ friends: UserInfo[] }>> {
    return this.request<{ friends: UserInfo[] }>("GET", "/api/privacy/friends");
  }

  async acceptFriendRequest(requestId: string): Promise<ApiResponse<{ accepted: boolean; convId?: string }>> {
    return this.request<{ accepted: boolean; convId?: string }>("POST", "/api/privacy/friend-requests/" + requestId + "/accept");
  }

  async rejectFriendRequest(requestId: string): Promise<ApiResponse<{ rejected: boolean }>> {
    return this.request<{ rejected: boolean }>("POST", "/api/privacy/friend-requests/" + requestId + "/reject");
  }

  // ========== 设备互联（L2 配对 + L1 补拉）==========

  /** 手机端确认配对：提交 6 位码 + 本机 deviceId → device_pairs 落库，返回 pairId */
  async confirmPair(code: string, mobileDeviceId: string): Promise<ApiResponse<{ pairId: string }>> {
    return this.request<{ pairId: string }>("POST", "/api/pairs/confirm", { code, mobileDeviceId });
  }

  /** 我的全部设备对列表 */
  async getPairs(): Promise<ApiResponse<Array<{
    id: string;
    userId: string;
    desktopDeviceId: string;
    mobileDeviceId: string;
    pairedAt: number;
  }>>> {
    return this.request<Array<{
      id: string;
      userId: string;
      desktopDeviceId: string;
      mobileDeviceId: string;
      pairedAt: number;
    }>>("GET", "/api/pairs");
  }

  /** 解除配对 */
  async removePair(pairId: string): Promise<ApiResponse<{ removed: boolean }>> {
    return this.request<{ removed: boolean }>("DELETE", "/api/pairs/" + encodeURIComponent(pairId));
  }

  /** 补拉：回放该设备对 sinceTs 之后的互联事件 */
  async getPairEvents(pairId: string, sinceTs: number = 0): Promise<ApiResponse<{
    events: Array<{
      msgId: string;
      pairId: string;
      kind: string;
      payload: unknown;
      ts: number;
    }>;
    hasMore: boolean;
  }>> {
    return this.request<{
      events: Array<{
        msgId: string;
        pairId: string;
        kind: string;
        payload: unknown;
        ts: number;
      }>;
      hasMore: boolean;
    }>("GET", `/api/pairs/${encodeURIComponent(pairId)}/events?sinceTs=${sinceTs}`);
  }

  /** 当前用户的所有设备（多端在线状态：在线 / 离线） */
  async getDevices(): Promise<
    ApiResponse<Array<{ id: string; name: string; type: string; online: boolean; lastSeenAt?: string }>>
  > {
    return this.request("GET", "/api/devices");
  }

  // ========== Memory API ==========

  /** 获取记忆摘要 */
  async getMemory(): Promise<ApiResponse<MemorySummary>> {
    return this.request<MemorySummary>("GET", "/api/memory");
  }

  /** 获取 Agent 的记忆条目 */
  async getAgentMemory(agentId: string): Promise<ApiResponse<unknown[]>> {
    return this.request<unknown[]>("GET", "/api/memory/" + agentId);
  }

  // ========== Skill API ==========

  /** 获取所有技能 */
  async getSkills(): Promise<ApiResponse<SkillInfo[]>> {
    return this.request<SkillInfo[]>("GET", "/api/skills");
  }

  // ========== E2E 密钥目录 ==========

  /** 注册/轮换身份密钥包（登录后懒注册；重复注册 = 轮换） */
  async registerE2eIdentity(input: {
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKeys: Array<{ id: number; key: string }>;
  }): Promise<ApiResponse<{ registered: boolean }>> {
    return this.request<{ registered: boolean }>("PUT", "/api/e2e/register", input);
  }

  /** 取对端密钥包（OPK 取走即删；发起会话用） */
  async getE2eBundle(userId: string): Promise<ApiResponse<{
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKey?: { id: number; key: string };
  }>> {
    return this.request("GET", `/api/e2e/bundle/${userId}`);
  }

  /** 追加补充一次性预密钥 */
  async addE2eOneTimePreKeys(keys: Array<{ id: number; key: string }>): Promise<ApiResponse<{ remaining: number }>> {
    return this.request<{ remaining: number }>("POST", "/api/e2e/opks", { oneTimePreKeys: keys });
  }

  /** 对端是否已启用端到端加密（capability 缓存由 e2eService 管理） */
  async getE2eCapability(userId: string): Promise<ApiResponse<{ enrolled: boolean }>> {
    return this.request<{ enrolled: boolean }>(`GET`, `/api/e2e/capability/${userId}`);
  }

  // ========== Health API ==========

  /** 健康检查 */
  async getHealth(): Promise<ApiResponse<HealthResponse>> {
    return this.request<HealthResponse>("GET", "/api/health");
  }
}

export const api = new ApiService();
