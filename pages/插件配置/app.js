const defaultReplyConfig = {
    draw_pending_message: "🎨 收到灵感，正在绘制...",
    selfie_pending_message: "ℹ️ 正在为「{persona_name}」生成自拍，请稍候...",
    draw_error_message: "💥 绘制失败: {error}",
    selfie_error_message: "💥 自拍生成失败: {error}"
};

const defaultCacheConfig = {
    enable_scheduled_cleanup: false,
    scheduled_cleanup_interval_hours: 24,
    enable_size_limit_cleanup: false,
    max_cache_size_mb: 512
};

const GEMINI_OFFICIAL_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_DEFAULT_MODELS = [GEMINI_DEFAULT_MODEL, "gemini-3-pro-image-preview"];

const mockConfig = {
    permission_config: { usable_users: "", allowed_users: "", blocked_users: "", unlimited_groups: "" },
    usage_config: {
        enable_daily_limit: false,
        daily_image_limit: 20,
        enable_checkin: false,
        checkin_bonus_min: 1,
        checkin_bonus_max: 3
    },
    cache_config: { ...defaultCacheConfig },
    reply_config: { ...defaultReplyConfig },
    persona_config: {
        active_persona_id: "default",
        persona_name: "默认助理",
        persona_base_prompt: "",
        persona_ref_image: [],
        profiles: [
            { id: "default", persona_name: "默认助理", persona_base_prompt: "", persona_ref_image: [] }
        ]
    },
    optimizer_config: {
        enable_optimizer: true,
        optimizer_style: "手机日常原生感",
        chain_optimizer: "node_1",
        optimizer_model: "gpt-4o-mini",
        optimizer_timeout: 15,
        max_batch_count: 0,
        optimizer_custom_prompt: ""
    },
    router_config: { chain_text2img: "node_1", chain_selfie: "node_1", chain_video: "video_node_1" },
    presets: ["写真:daily smartphone portrait --size 1024x1024"],
    providers: [
        { id: "node_1", api_type: "openai_image", base_url: "https://api.example.com/v1", model: "gpt-image-1", available_models: ["gpt-image-1", "dall-e-3"], image_resolution_mode: "official", image_size: "", aspect_ratio: "", timeout: 60, api_keys: "" }
    ],
    video_providers: [
        { id: "video_node_1", api_type: "async_task", base_url: "https://api.example.com/v1", model: "veo", available_models: ["veo"], timeout: 300, api_keys: "" }
    ],
    verbose_report: false,
    hide_preset_prompt: true,
    show_generation_time: false,
    show_request_model: false
};

const mockUsageStats = {
    date: new Date().toISOString().slice(0, 10),
    total: 8,
    users: [
        { user_id: "10001", display_name: "10001", count: 5, bonus: 2, checkin_at: Math.floor(Date.now() / 1000) - 2400, last_at: Math.floor(Date.now() / 1000) - 1800, access_level: "limited" },
        { user_id: "10002", display_name: "10002", count: 3, bonus: 0, checkin_at: 0, last_at: Math.floor(Date.now() / 1000) - 7200, access_level: "unlimited_user" }
    ],
    quota: { enabled: false, daily_limit: 0 }
};

const mockCacheStats = {
    total: { count: 0, bytes: 0, human_size: "0 B" },
    dirs: {
        temp_images: { count: 0, bytes: 0, human_size: "0 B" },
        user_refs: { count: 0, bytes: 0, human_size: "0 B" }
    },
    targets: ["temp_images", "user_refs"]
};

const bridge = window.AstrBotPluginPage || {
    ready: async () => ({}),
    apiGet: async (name) => JSON.parse(JSON.stringify(
        name === "get_usage_stats"
            ? { success: true, stats: mockUsageStats }
            : name === "get_cache_stats"
                ? { success: true, stats: mockCacheStats }
                : mockConfig
    )),
    apiPost: async (name, payload) => {
        console.info(`[OmniDraw local preview] ${name}`, payload);
        return { success: true, stats: mockCacheStats, cleanup: { deleted_count: 0, human_deleted_size: "0 B" } };
    }
};

const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

let state = {
    permission_config: { usable_users: "", allowed_users: "", blocked_users: "", unlimited_groups: "" },
    usage_config: {
        enable_daily_limit: false,
        daily_image_limit: 20,
        enable_checkin: false,
        checkin_bonus_min: 1,
        checkin_bonus_max: 3
    },
    usage_stats: { date: "", total: 0, users: [], quota: { enabled: false, daily_limit: 0 } },
    cache_config: { ...defaultCacheConfig },
    cache_stats: JSON.parse(JSON.stringify(mockCacheStats)),
    reply_config: { ...defaultReplyConfig },
    persona_config: { active_persona_id: "default", profiles: [], persona_ref_image: [], active_time_period: "day" },
    persona_period: "day",
    time_period_hours: { morning: { start: 6, end: 9 }, day: { start: 9, end: 18 }, evening: { start: 18, end: 6 } },
    optimizer_config: {},
    router_config: {},
    route_backup_enabled: { text2img: false, selfie: false, video: false },
    presets: [],
    providers: [],
    video_providers: [],
    verbose_report: false,
    hide_preset_prompt: true,
    show_generation_time: false,
    show_request_model: false
};

let initialized = false;
let savedSnapshot = "";
let dirtyState = false;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function parsePreset(rawPreset) {
    if (typeof rawPreset === "object" && rawPreset !== null) {
        return { name: rawPreset.name || "", prompt: rawPreset.prompt || "", hidden: Boolean(rawPreset.hidden) };
    }
    const text = String(rawPreset || "");
    const isHidden = text.startsWith("#");
    const content = isHidden ? text.slice(1) : text;
    const idx = content.indexOf(":");
    if (idx === -1) return { name: content, prompt: "", hidden: isHidden };
    return { name: content.slice(0, idx), prompt: content.slice(idx + 1), hidden: isHidden };
}

const deepFind = (obj, keys, def = "") => {
    if (!obj) return def;
    for (const key of keys) {
        if (obj[key] !== undefined) return obj[key];
    }
    return def;
};

const byId = (id) => document.getElementById(id);

function normalizeModelList(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(",");
    return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeTextAreaKeys(value) {
    return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function mergeUniqueModels(...groups) {
    return [...new Set(groups.flat().map((item) => String(item || "").trim()).filter(Boolean))];
}

function applyImageProviderDefaults(provider) {
    if (!provider) return provider;
    provider.image_resolution_mode = provider.image_resolution_mode === "custom" ? "custom" : "official";
    if (provider.api_type === "gemini_official") {
        if (!String(provider.base_url || "").trim() || provider.base_url === "https://api.example.com/v1") {
            provider.base_url = GEMINI_OFFICIAL_BASE_URL;
        }
        provider.available_models = mergeUniqueModels(provider.available_models || [], GEMINI_DEFAULT_MODELS);
        if (!String(provider.model || "").trim()) {
            provider.model = provider.available_models[0] || GEMINI_DEFAULT_MODEL;
        }
        const timeout = parseFloat(provider.timeout);
        provider.timeout = Number.isFinite(timeout) && timeout >= 120 ? timeout : 120;
    }
    return provider;
}

function readNonnegativeIntInput(id, fallback = 0) {
    const parsed = parseInt(byId(id)?.value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return !["", "0", "false", "no", "off", "关闭"].includes(String(value ?? "").trim().toLowerCase());
}

function normalizeIdText(value) {
    const source = Array.isArray(value)
        ? value.flatMap((item) => String(item || "").split(/[\s,]+/))
        : String(value || "").split(/[\s,]+/);
    return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].join("\n");
}

function splitChain(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || "").replace(/\r/g, "\n").split(/[\s,]+/);
    const seen = new Set();
    return source
        .map((item) => String(item || "").trim())
        .filter((item) => {
            if (!item || seen.has(item)) return false;
            seen.add(item);
            return true;
        });
}

function joinChain(value) {
    return splitChain(value).join(",");
}

function mergeIdText(...values) {
    return normalizeIdText(values.flatMap((value) => normalizeIdText(value).split("\n")));
}

function normalizePermissionConfig(value = {}) {
    return {
        usable_users: mergeIdText(value.usable_users, value.access_users, value.use_whitelist),
        allowed_users: mergeIdText(value.allowed_users, value.unlimited_users, value.user_whitelist),
        blocked_users: mergeIdText(value.blocked_users, value.user_blacklist),
        unlimited_groups: mergeIdText(value.unlimited_groups, value.group_whitelist)
    };
}

function normalizeUsageConfig(value = {}) {
    const limit = parseInt(value.daily_image_limit ?? 20, 10);
    const bonusMin = parseInt(value.checkin_bonus_min ?? 1, 10);
    const bonusMax = parseInt(value.checkin_bonus_max ?? 3, 10);
    const normalizedMin = Number.isFinite(bonusMin) && bonusMin >= 0 ? bonusMin : 1;
    const normalizedMax = Number.isFinite(bonusMax) && bonusMax >= 0 ? bonusMax : 3;
    return {
        enable_daily_limit: Boolean(value.enable_daily_limit),
        daily_image_limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
        enable_checkin: Boolean(value.enable_checkin),
        checkin_bonus_min: normalizedMin,
        checkin_bonus_max: Math.max(normalizedMin, normalizedMax)
    };
}

function normalizeCacheConfig(value = {}) {
    const interval = parseInt(value.scheduled_cleanup_interval_hours ?? defaultCacheConfig.scheduled_cleanup_interval_hours, 10);
    const maxMb = parseInt(value.max_cache_size_mb ?? defaultCacheConfig.max_cache_size_mb, 10);
    return {
        enable_scheduled_cleanup: normalizeBool(value.enable_scheduled_cleanup),
        scheduled_cleanup_interval_hours: Number.isFinite(interval) && interval > 0 ? interval : defaultCacheConfig.scheduled_cleanup_interval_hours,
        enable_size_limit_cleanup: normalizeBool(value.enable_size_limit_cleanup),
        max_cache_size_mb: Number.isFinite(maxMb) && maxMb > 0 ? maxMb : defaultCacheConfig.max_cache_size_mb
    };
}

function normalizeReplyConfig(value = {}) {
    return {
        draw_pending_message: String(value.draw_pending_message ?? defaultReplyConfig.draw_pending_message).trim() || defaultReplyConfig.draw_pending_message,
        selfie_pending_message: String(value.selfie_pending_message ?? defaultReplyConfig.selfie_pending_message).trim() || defaultReplyConfig.selfie_pending_message,
        draw_error_message: String(value.draw_error_message ?? defaultReplyConfig.draw_error_message).trim() || defaultReplyConfig.draw_error_message,
        selfie_error_message: String(value.selfie_error_message ?? defaultReplyConfig.selfie_error_message).trim() || defaultReplyConfig.selfie_error_message
    };
}

function normalizeUsageStats(value = {}) {
    const stats = value.stats || value;
    const rawUsers = Array.isArray(stats.users)
        ? stats.users
        : Object.entries(stats.users || {}).map(([userId, record]) => ({ user_id: userId, ...(record || {}) }));
    const users = rawUsers
        .map((user) => ({
            user_id: String(user.user_id || user.id || "").trim(),
            display_name: String(user.display_name || user.name || "").trim(),
            count: parseInt(user.count || 0, 10) || 0,
            bonus: parseInt(user.bonus || 0, 10) || 0,
            checkin_at: parseInt(user.checkin_at || 0, 10) || 0,
            group_id: String(user.group_id || "").trim(),
            access_level: String(user.access_level || "limited").trim(),
            last_at: parseInt(user.last_at || 0, 10) || 0
        }))
        .filter((user) => user.user_id)
        .sort((a, b) => b.count - a.count || a.user_id.localeCompare(b.user_id));
    const total = Number.isFinite(parseInt(stats.total, 10))
        ? parseInt(stats.total, 10)
        : users.reduce((sum, user) => sum + user.count, 0);
    return {
        date: stats.date || "",
        total,
        users,
        quota: {
            enabled: Boolean(stats.quota?.enabled),
            daily_limit: parseInt(stats.quota?.daily_limit || 0, 10) || 0,
            checkin_enabled: Boolean(stats.quota?.checkin_enabled),
            checkin_bonus_min: parseInt(stats.quota?.checkin_bonus_min || 0, 10) || 0,
            checkin_bonus_max: parseInt(stats.quota?.checkin_bonus_max || 0, 10) || 0
        }
    };
}

function normalizeCacheStats(value = {}) {
    const stats = value.stats || value;
    const dirs = stats.dirs || {};
    const normalizeDir = (name) => ({
        count: parseInt(dirs[name]?.count || 0, 10) || 0,
        bytes: parseInt(dirs[name]?.bytes || 0, 10) || 0,
        human_size: String(dirs[name]?.human_size || "0 B")
    });
    const totalBytes = parseInt(stats.total?.bytes || 0, 10) || 0;
    return {
        total: {
            count: parseInt(stats.total?.count || 0, 10) || 0,
            bytes: totalBytes,
            human_size: String(stats.total?.human_size || formatBytes(totalBytes))
        },
        dirs: {
            temp_images: normalizeDir("temp_images"),
            user_refs: normalizeDir("user_refs")
        },
        targets: Array.isArray(stats.targets) ? stats.targets : ["temp_images", "user_refs"]
    };
}

function formatBytes(size) {
    let value = Math.max(0, Number(size) || 0);
    const units = ["B", "KB", "MB", "GB"];
    for (const unit of units) {
        if (value < 1024 || unit === "GB") {
            return unit === "B" ? `${Math.round(value)} B` : `${value.toFixed(1)} ${unit}`;
        }
        value /= 1024;
    }
    return `${value.toFixed(1)} GB`;
}

function formatUsageTime(timestamp) {
    if (!timestamp) return "—";
    return new Date(timestamp * 1000).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function normalizePersonaImages(value) {
    if (typeof value === "string" && value.trim()) return [value];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [];
}

function normalizePeriodKey(value, fallback = "day") {
    const period = String(value || "").trim();
    return ["morning", "day", "evening"].includes(period) ? period : fallback;
}

function normalizeTimePeriodRefs(value = {}) {
    const refs = value && typeof value === "object" ? value : {};
    return {
        morning: normalizePersonaImages(refs.morning || []),
        day: normalizePersonaImages(refs.day || []),
        evening: normalizePersonaImages(refs.evening || [])
    };
}

function detectCurrentPeriod(hour = new Date().getHours()) {
    for (const periodKey of ["morning", "day", "evening"]) {
        const period = state.time_period_hours?.[periodKey] || {};
        const start = Number.isFinite(parseInt(period.start, 10)) ? parseInt(period.start, 10) : 0;
        const end = Number.isFinite(parseInt(period.end, 10)) ? parseInt(period.end, 10) : 0;
        if (end > start) {
            if (hour >= start && hour < end) return periodKey;
        } else if (hour >= start || hour < end) {
            return periodKey;
        }
    }
    return "day";
}

function isPreviewImageRef(value) {
    const ref = String(value || "");
    return ref.includes("astrbot_plugin_omnidraw/get_image")
        || ref.includes("astrbot_plugin_omnidraw_tuo/get_image");
}

function extractPreviewToken(value) {
    const ref = String(value || "");
    if (!ref) return "";
    try {
        const parsed = new URL(ref, window.location.origin);
        return parsed.searchParams.get("token") || "";
    } catch {
        const match = ref.match(/[?&]token=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }
}

function setPreviewImageSource(img, value) {
    const ref = String(value || "");
    img.loading = "lazy";
    img.decoding = "async";
    if (!ref) {
        img.removeAttribute("src");
        img.classList.add("is-missing");
        return;
    }
    if (!isPreviewImageRef(ref)) {
        img.src = ref;
        return;
    }

    const token = extractPreviewToken(ref);
    img.src = transparentPixel;
    img.classList.add("is-loading");
    img.title = "点击加载参考图预览";
    if (!token) {
        img.classList.replace("is-loading", "is-missing");
        return;
    }

    const loadPreview = async () => {
        if (img.dataset.loadingPreview === "1") return;
        img.dataset.loadingPreview = "1";
        try {
            const res = await bridge.apiPost("get_image_data", { token });
            if (!img.isConnected) return;
            if (res?.success && res.image) {
                img.src = res.image;
                img.classList.remove("is-loading", "is-missing");
                img.title = "";
            } else {
                img.classList.replace("is-loading", "is-missing");
                img.title = "预览加载失败，请重新上传";
            }
        } catch (error) {
            console.warn("[OmniDraw] 参考图预览加载失败", error);
            if (img.isConnected) {
                img.classList.replace("is-loading", "is-missing");
                img.title = "预览加载失败，请重新上传";
            }
        } finally {
            delete img.dataset.loadingPreview;
        }
    };
    img.addEventListener("click", loadPreview, { once: false });
}

function totalPersonaImages(profile) {
    const shared = normalizePersonaImages(profile.persona_ref_image).length;
    const tpr = normalizeTimePeriodRefs(profile.time_period_refs || {});
    const periodCount = (normalizePersonaImages(tpr.morning).length +
        normalizePersonaImages(tpr.day).length +
        normalizePersonaImages(tpr.evening).length);
    return Math.max(shared, periodCount);
}

function makePersonaId(seed, fallbackIndex = 1) {
    const ascii = String(seed || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return ascii || `persona_${fallbackIndex}`;
}

function uniquePersonaId(seed, index, usedIds) {
    const base = makePersonaId(seed, index + 1);
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}

function normalizePersonaProfiles(rawPersonaConfig = {}) {
    const rawProfiles = Array.isArray(rawPersonaConfig.profiles) && rawPersonaConfig.profiles.length
        ? rawPersonaConfig.profiles
        : [{
            id: rawPersonaConfig.active_persona_id || rawPersonaConfig.persona_id || "default",
            persona_name: rawPersonaConfig.persona_name || "默认助理",
            persona_base_prompt: rawPersonaConfig.persona_base_prompt || "",
            persona_ref_image: rawPersonaConfig.persona_ref_image || rawPersonaConfig.persona_ref_images || []
        }];

    const usedIds = new Set();
    const profiles = rawProfiles.map((profile, index) => {
        const source = profile && typeof profile === "object" ? profile : {};
        const name = String(source.persona_name || source.name || (index === 0 ? "默认助理" : `人设 ${index + 1}`)).trim() || (index === 0 ? "默认助理" : `人设 ${index + 1}`);
        const id = uniquePersonaId(source.id || (index === 0 ? "default" : name), index, usedIds);
        const rawPeriodRefs = normalizeTimePeriodRefs(source.time_period_refs || {});
        return {
            id,
            persona_name: name,
            persona_base_prompt: String(source.persona_base_prompt || source.base_prompt || ""),
            persona_ref_image: normalizePersonaImages(source.persona_ref_image || source.persona_ref_images || source.ref_images),
            time_period_refs: rawPeriodRefs
        };
    });

    if (!profiles.length) {
        profiles.push({ id: "default", persona_name: "默认助理", persona_base_prompt: "", persona_ref_image: [], time_period_refs: { morning: [], day: [], evening: [] } });
    }

    const requestedActive = String(rawPersonaConfig.active_persona_id || "").trim();
    const requestedActiveLower = requestedActive.toLowerCase();
    const activeProfile = profiles.find((profile) => profile.id === requestedActive || profile.id.toLowerCase() === requestedActiveLower) || profiles[0];
    const activeTimePeriod = normalizePeriodKey(rawPersonaConfig.active_time_period, "day");
    return {
        active_persona_id: activeProfile.id,
        profiles,
        persona_name: activeProfile.persona_name,
        persona_base_prompt: activeProfile.persona_base_prompt,
        persona_ref_image: activeProfile.persona_ref_image,
        active_time_period: activeTimePeriod
    };
}

function getActivePersona() {
    if (!Array.isArray(state.persona_config.profiles) || !state.persona_config.profiles.length) {
        state.persona_config.profiles = [{ id: "default", persona_name: "默认助理", persona_base_prompt: "", persona_ref_image: [], time_period_refs: { morning: [], day: [], evening: [] } }];
    }
    let active = state.persona_config.profiles.find((profile) => profile.id === state.persona_config.active_persona_id);
    if (!active) {
        active = state.persona_config.profiles[0];
        state.persona_config.active_persona_id = active.id;
    }
    active.persona_ref_image = normalizePersonaImages(active.persona_ref_image);
    active.time_period_refs = normalizeTimePeriodRefs(active.time_period_refs);
    return active;
}

function syncActivePersonaMirror() {
    const active = getActivePersona();
    state.persona_config.active_persona_id = active.id;
    state.persona_config.persona_name = active.persona_name;
    state.persona_config.persona_base_prompt = active.persona_base_prompt;
    state.persona_config.persona_ref_image = active.persona_ref_image;
}

function writeActivePersonaFieldsFromForm() {
    const active = getActivePersona();
    const nameInput = byId("persona_name");
    const promptInput = byId("persona_prompt");
    if (nameInput) active.persona_name = nameInput.value.trim() || "未命名人设";
    if (promptInput) active.persona_base_prompt = promptInput.value;
    syncActivePersonaMirror();
}

function switchPersonaPeriod(period) {
    const nextPeriod = normalizePeriodKey(period, state.persona_period || "day");
    writeActivePersonaFieldsFromForm();
    state.persona_period = nextPeriod;
    state.persona_config.active_time_period = nextPeriod;
    syncActivePersonaMirror();
    renderPersonaImages();
    renderPersonaProfiles();
    setDirty();
}

function bindPersonaFields() {
    syncActivePersonaMirror();
    const active = getActivePersona();
    byId("persona_name").value = active.persona_name || "默认助理";
    byId("persona_prompt").value = active.persona_base_prompt || "";
}

function showToast(message, type = "success") {
    const container = byId("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "success" ? "✓" : "!";
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(icon, text);
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("toast-fadeout"), 2600);
    setTimeout(() => toast.remove(), 2920);
}

function setDirty(force) {
    if (!initialized) return;
    dirtyState = typeof force === "boolean" ? force : true;
    const isDirty = dirtyState;
    document.body.classList.toggle("is-dirty", isDirty);
    const saveState = byId("save-state");
    if (saveState) saveState.textContent = isDirty ? "有未保存更改" : "配置已同步";
}

function updateMetrics() {
    byId("metric-image-nodes").textContent = state.providers.length;
    byId("metric-video-nodes").textContent = state.video_providers.length;
    byId("metric-presets").textContent = state.presets.filter((preset) => preset.name.trim()).length;
    byId("metric-today-images").textContent = state.usage_stats.total || 0;
}

function usageAccessLabel(level) {
    return ({
        limited: "受限",
        usable_user: "可使用白名单",
        unlimited_user: "用户白名单",
        unlimited_group: "群白名单",
        not_usable_user: "未在可使用白名单",
        blocked_user: "黑名单"
    }[level] || "受限");
}

function renderUsageStats() {
    const stats = state.usage_stats || {};
    byId("usage-stat-date").textContent = stats.date || "今日";
    byId("usage-stat-total").textContent = stats.total || 0;
    byId("usage-stat-users").textContent = (stats.users || []).length;
    byId("usage-stat-limit").textContent = state.usage_config.enable_daily_limit
        ? `${state.usage_config.daily_image_limit} 张/人${state.usage_config.enable_checkin ? " + 签到" : ""}`
        : "不限";

    const container = byId("usage-users-container");
    if (!container) return;
    const users = stats.users || [];
    container.innerHTML = users.map((user) => {
        const label = user.display_name && user.display_name !== user.user_id
            ? `${escapeHtml(user.display_name)} · ${escapeHtml(user.user_id)}`
            : escapeHtml(user.user_id);
        const accessLabel = usageAccessLabel(user.access_level);
        const isUnlimited = user.access_level === "unlimited_user" || user.access_level === "unlimited_group";
        const effectiveLimit = (state.usage_config.daily_image_limit || 0) + (user.bonus || 0);
        const quotaText = state.usage_config.enable_daily_limit
            ? (isUnlimited ? `${user.count} · 不限` : `${user.count}/${effectiveLimit}`)
            : `${user.count}`;
        const meta = [`最后生成 ${formatUsageTime(user.last_at)}`, accessLabel];
        if (user.group_id) meta.push(`群 ${escapeHtml(user.group_id)}`);
        if (user.bonus) meta.push(`签到 +${user.bonus}`);
        if (user.checkin_at) meta.push(`签到 ${formatUsageTime(user.checkin_at)}`);
        return `
            <div class="usage-user-row">
                <div class="usage-user-main">
                    <strong>${label}</strong>
                    <small>${meta.join(" · ")}</small>
                </div>
                <span>${quotaText}</span>
            </div>
        `;
    }).join("") || '<div class="empty-state">今日暂无生图记录</div>';
    updateMetrics();
}

async function loadUsageStats(showToastOnSuccess = false) {
    try {
        const res = await bridge.apiGet("get_usage_stats");
        state.usage_stats = normalizeUsageStats(res?.stats || res || {});
        renderUsageStats();
        if (showToastOnSuccess) showToast("统计已刷新");
    } catch (error) {
        console.error(error);
        if (showToastOnSuccess) showToast("统计刷新失败", "error");
        renderUsageStats();
    }
}

function renderCacheStats() {
    const stats = normalizeCacheStats(state.cache_stats || {});
    state.cache_stats = stats;
    const total = stats.total || {};
    const temp = stats.dirs?.temp_images || {};
    const refs = stats.dirs?.user_refs || {};
    if (byId("cache-total-count")) byId("cache-total-count").textContent = total.count || 0;
    if (byId("cache-total-size")) byId("cache-total-size").textContent = total.human_size || "0 B";
    if (byId("cache-temp-count")) byId("cache-temp-count").textContent = temp.count || 0;
    if (byId("cache-temp-size")) byId("cache-temp-size").textContent = temp.human_size || "0 B";
    if (byId("cache-refs-count")) byId("cache-refs-count").textContent = refs.count || 0;
    if (byId("cache-refs-size")) byId("cache-refs-size").textContent = refs.human_size || "0 B";
}

async function loadCacheStats(showToastOnSuccess = false) {
    try {
        const res = await bridge.apiGet("get_cache_stats");
        state.cache_stats = normalizeCacheStats(res?.stats || res || {});
        renderCacheStats();
        if (showToastOnSuccess) showToast("缓存统计已刷新");
    } catch (error) {
        console.error(error);
        if (showToastOnSuccess) showToast("缓存统计刷新失败", "error");
        renderCacheStats();
    }
}

async function clearCache(btn) {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "清理中...";
    try {
        const res = await bridge.apiPost("clear_cache", {});
        if (res?.success) {
            state.cache_stats = normalizeCacheStats(res.stats || {});
            renderCacheStats();
            const cleanup = res.cleanup || {};
            showToast(`已清理 ${cleanup.deleted_count || 0} 个图片，释放 ${cleanup.human_deleted_size || "0 B"}`);
        } else {
            showToast(res?.message || "缓存清理失败", "error");
        }
    } catch (error) {
        console.error(error);
        showToast("网络错误", "error");
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 420);
    }
}

const routeDefs = {
    text2img: {
        stateKey: "chain_text2img",
        inputId: "route_img",
        selectorId: "sel-route-img",
        backupSelectorId: "sel-route-img-backup",
        backupToggleId: "route_img_backup",
        fallback: "node_1",
        source: () => state.providers
    },
    selfie: {
        stateKey: "chain_selfie",
        inputId: "route_selfie",
        selectorId: "sel-route-selfie",
        backupSelectorId: "sel-route-selfie-backup",
        backupToggleId: "route_selfie_backup",
        fallback: "node_1",
        source: () => state.providers
    },
    video: {
        stateKey: "chain_video",
        inputId: "route_video",
        selectorId: "sel-route-video",
        backupSelectorId: "sel-route-video-backup",
        backupToggleId: "route_video_backup",
        fallback: "video_node_1",
        source: () => state.video_providers
    }
};

function routeChain(routeName) {
    const def = routeDefs[routeName];
    if (!def) return [];
    const chain = splitChain(state.router_config[def.stateKey]);
    if (chain.length) return chain;
    return def.fallback ? [def.fallback] : [];
}

function routePrimary(routeName) {
    return routeChain(routeName)[0] || "";
}

function routeBackups(routeName) {
    return routeChain(routeName).slice(1);
}

function writeRouteChain(routeName, chain) {
    const def = routeDefs[routeName];
    if (!def) return;
    const normalized = splitChain(chain);
    state.router_config[def.stateKey] = normalized.join(",");
    const hiddenInput = byId(def.inputId);
    if (hiddenInput) hiddenInput.value = normalized[0] || "";
}

function bounceRoute(routeName) {
    const def = routeDefs[routeName];
    const control = def ? byId(def.backupToggleId)?.closest(".route-control") : null;
    if (!control) return;
    control.classList.remove("route-bounce");
    void control.offsetWidth;
    control.classList.add("route-bounce");
    window.setTimeout(() => control.classList.remove("route-bounce"), 560);
}

function syncRouteFromHidden(routeName) {
    const def = routeDefs[routeName];
    if (!def) return;
    const primary = String(byId(def.inputId)?.value || routePrimary(routeName) || def.fallback || "").trim();
    const backups = state.route_backup_enabled[routeName]
        ? routeBackups(routeName).filter((nodeId) => nodeId !== primary)
        : [];
    writeRouteChain(routeName, primary ? [primary, ...backups] : backups);
}

function setRouteBackupEnabled(routeName, enabled) {
    if (!routeDefs[routeName]) return;
    state.route_backup_enabled[routeName] = Boolean(enabled);
    if (!enabled) {
        writeRouteChain(routeName, [routePrimary(routeName)]);
    }
    renderSelectors();
    bounceRoute(routeName);
}

function handleRouteChipClick(chip) {
    const routeName = chip.getAttribute("data-route");
    const role = chip.getAttribute("data-role");
    const nodeId = chip.getAttribute("data-id");
    if (!routeDefs[routeName] || !nodeId) return;

    const chain = routeChain(routeName);
    const currentPrimary = chain[0] || "";
    let backups = chain.slice(1);

    if (role === "backup") {
        if (nodeId === currentPrimary) return;
        const existingIndex = backups.indexOf(nodeId);
        if (existingIndex === -1) {
            backups.push(nodeId);
        } else {
            backups.splice(existingIndex, 1);
        }
        writeRouteChain(routeName, [currentPrimary, ...backups]);
        renderSelectors();
        bounceRoute(routeName);
        setDirty();
        return;
    }

    backups = backups.filter((backupId) => backupId !== nodeId);
    writeRouteChain(routeName, [nodeId, ...backups]);
    renderSelectors();
    bounceRoute(routeName);
    setDirty();
}

function renderSelectors() {
    const renderPrimaryTo = (routeName) => {
        const def = routeDefs[routeName];
        const container = byId(def.selectorId);
        const hiddenInput = byId(def.inputId);
        if (!container || !hiddenInput) return;
        const currentVal = routePrimary(routeName);
        hiddenInput.value = currentVal;
        const sourceList = def.source();
        const html = sourceList.map((node) => {
            const nodeId = node.id || node["节点ID"];
            if (!nodeId) return "";
            const isActive = nodeId === currentVal;
            return `<button type="button" class="selector-chip ${isActive ? "active" : ""}" data-route="${routeName}" data-role="primary" data-id="${escapeHtml(nodeId)}">${escapeHtml(nodeId)}</button>`;
        }).join("");
        container.innerHTML = html || '<span class="empty-hint">暂无可选节点</span>';
    };

    const renderBackupTo = (routeName) => {
        const def = routeDefs[routeName];
        const container = byId(def.backupSelectorId);
        const toggle = byId(def.backupToggleId);
        if (!container || !toggle) return;

        const primary = routePrimary(routeName);
        const backups = routeBackups(routeName);
        const enabled = Boolean(state.route_backup_enabled[routeName] || backups.length);
        state.route_backup_enabled[routeName] = enabled;
        toggle.checked = enabled;
        toggle.closest(".route-backup-panel")?.classList.toggle("is-enabled", enabled);
        toggle.closest(".route-control")?.classList.toggle("has-backups-enabled", enabled);

        const sourceList = def.source();
        const html = sourceList.map((node) => {
            const nodeId = node.id || node["节点ID"];
            if (!nodeId || nodeId === primary) return "";
            const order = backups.indexOf(nodeId);
            const isActive = order !== -1;
            const orderBadge = isActive ? `<span class="selector-chip-order">${order + 1}</span>` : "";
            return `<button type="button" class="selector-chip ${isActive ? "active" : ""}" data-route="${routeName}" data-role="backup" data-id="${escapeHtml(nodeId)}"><span>${escapeHtml(nodeId)}</span>${orderBadge}</button>`;
        }).join("");
        container.innerHTML = html || '<span class="empty-hint">暂无可选备用节点</span>';
    };

    const renderSingleTo = (containerId, sourceList, inputId) => {
        const container = byId(containerId);
        const hiddenInput = byId(inputId);
        if (!container || !hiddenInput) return;
        const currentVal = hiddenInput.value;
        const html = sourceList.map((node) => {
            const nodeId = node.id || node["节点ID"];
            if (!nodeId) return "";
            const isActive = nodeId === currentVal;
            return `<button type="button" class="selector-chip ${isActive ? "active" : ""}" data-id="${escapeHtml(nodeId)}" data-input="${escapeHtml(inputId)}">${escapeHtml(nodeId)}</button>`;
        }).join("");
        container.innerHTML = html || '<span class="empty-hint">暂无可选节点</span>';
    };

    renderPrimaryTo("text2img");
    renderBackupTo("text2img");
    renderPrimaryTo("selfie");
    renderBackupTo("selfie");
    renderSingleTo("sel-opt-chain", state.providers, "opt_chain");
    renderPrimaryTo("video");
    renderBackupTo("video");
}

function renderPersonaProfiles() {
    const container = byId("persona-profiles-container");
    if (!container) return;
    syncActivePersonaMirror();
    const profiles = state.persona_config.profiles || [];
    container.innerHTML = profiles.map((profile, index) => {
        const isActive = profile.id === state.persona_config.active_persona_id;
        const deleteControl = profiles.length > 1
            ? `<span class="persona-profile-delete" data-action="del-persona" data-index="${index}" title="删除人设">×</span>`
            : "";
        return `
            <button type="button" class="persona-profile-chip ${isActive ? "active" : ""}" data-action="switch-persona" data-index="${index}">
                <span class="persona-profile-name">${escapeHtml(profile.persona_name || "未命名人设")}</span>
                <small>${escapeHtml(profile.id)} · ${totalPersonaImages(profile)} 图</small>
                ${deleteControl}
            </button>
        `;
    }).join("");
}

function renderPersonaImages() {
    const container = byId("persona-upload-container");
    if (!container) return;
    container.querySelectorAll(".image-preview-wrapper").forEach((el) => el.remove());
    const trigger = byId("persona-upload-trigger");
    const period = state.persona_period || "day";
    const periodLabels = { morning: "早上", day: "白天", evening: "晚上" };
    const labelEl = byId("persona-period-label");
    if (labelEl) labelEl.textContent = periodLabels[period] || "白天";

    // 更新时段tab：高亮选中的tab，标记当前激活时段
    const activePeriod = state.persona_config.active_time_period || "day";
    document.querySelectorAll(".period-tab").forEach((tab) => {
        const tabPeriod = tab.getAttribute("data-period");
        tab.classList.toggle("active", tabPeriod === period);
        tab.classList.toggle("is-current", tabPeriod === activePeriod);
        const badge = tab.querySelector(".period-badge");
        if (tabPeriod === activePeriod) {
            if (!badge) {
                const span = document.createElement("span");
                span.className = "period-badge";
                span.textContent = "✓";
                tab.appendChild(span);
            }
        } else if (badge) {
            badge.remove();
        }
    });

    // 更新时段小时输入
    const periodHours = state.time_period_hours[period] || { start: 6, end: 9 };
    const startInput = byId("period-start");
    const endInput = byId("period-end");
    if (startInput) startInput.value = periodHours.start ?? 6;
    if (endInput) endInput.value = periodHours.end ?? 9;

    const activePersona = getActivePersona();
    // 优先使用时段专用参考图，若为空则回退到共享参考图
    let images = (activePersona.time_period_refs && activePersona.time_period_refs[period]) || [];
    if (!images.length) {
        images = activePersona.persona_ref_image || [];
    }
    images.forEach((url, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "image-preview-wrapper";
        const img = document.createElement("img");
        img.className = "image-preview";
        img.alt = `Reference ${idx + 1}`;
        setPreviewImageSource(img, url);
        const button = document.createElement("button");
        button.className = "btn-del-img";
        button.dataset.action = "del-persona-img";
        button.dataset.index = String(idx);
        button.type = "button";
        button.textContent = "×";
        wrapper.append(img, button);
        container.insertBefore(wrapper, trigger);
    });
    renderCurrentReferenceView();
}

function getCurrentReferenceInfo() {
    const activePersona = getActivePersona();
    const period = detectCurrentPeriod();
    const periodLabels = { morning: "早上", day: "白天", evening: "晚上" };
    const periodRefs = normalizePersonaImages(activePersona.time_period_refs?.[period] || []);
    const sharedRefs = normalizePersonaImages(activePersona.persona_ref_image || []);
    const refs = periodRefs.length ? periodRefs : sharedRefs;
    return {
        activePersona,
        period,
        periodLabel: periodLabels[period] || "白天",
        refs,
        sourceLabel: periodRefs.length ? "时段专用" : (sharedRefs.length ? "共享兜底" : "暂无参考图"),
        note: periodRefs.length
            ? `当前 /自拍 会使用「${periodLabels[period] || "白天"}」时段专用参考图。点击占位图可加载单张预览。`
            : sharedRefs.length
                ? `当前时段没有专用图，/自拍 会使用该人设的共享参考图。点击占位图可加载单张预览。`
                : "当前人设没有可用参考图。"
    };
}

function renderCurrentReferenceView() {
    const container = byId("current-ref-container");
    if (!container) return;
    if (!byId("tab-current-refs")?.classList.contains("active")) return;
    const info = getCurrentReferenceInfo();
    const personaEl = byId("current-ref-persona");
    const periodEl = byId("current-ref-period");
    const sourceEl = byId("current-ref-source");
    const countEl = byId("current-ref-count");
    const noteEl = byId("current-ref-note");
    if (personaEl) personaEl.textContent = info.activePersona.persona_name || "默认助理";
    if (periodEl) periodEl.textContent = info.periodLabel;
    if (sourceEl) sourceEl.textContent = info.sourceLabel;
    if (countEl) countEl.textContent = String(info.refs.length);
    if (noteEl) noteEl.textContent = info.note;

    container.innerHTML = "";
    if (!info.refs.length) {
        container.innerHTML = '<div class="empty-state readonly-empty">当前没有可展示的参考图</div>';
        return;
    }
    info.refs.forEach((url, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "image-preview-wrapper readonly-ref-item";
        const img = document.createElement("img");
        img.className = "image-preview";
        img.alt = `Current reference ${idx + 1}`;
        setPreviewImageSource(img, url);
        const badge = document.createElement("span");
        badge.className = "readonly-ref-index";
        badge.textContent = `#${idx + 1}`;
        wrapper.append(img, badge);
        container.appendChild(wrapper);
    });
}

function renderPresets() {
    const html = state.presets.map((p, i) => `
        <div class="list-item">
            <input type="text" class="input-glass preset-name" placeholder="快捷指令名" value="${escapeHtml(p.name)}" data-sync="preset-name" data-index="${i}">
            <span class="preset-arrow">→</span>
            <input type="text" class="input-glass preset-prompt" placeholder="底层提示词与参数" value="${escapeHtml(p.prompt)}" data-sync="preset-prompt" data-index="${i}">
            <label class="preset-hidden-label" title="隐藏后不在列表中显示，但仍可使用">
                <input type="checkbox" data-sync="preset-hidden" data-index="${i}" ${p.hidden ? "checked" : ""}> 隐藏
            </label>
            <button data-action="del-preset" data-index="${i}" class="btn-glass-secondary btn-danger" type="button">移除</button>
        </div>
    `).join("");
    byId("presets-container").innerHTML = html || '<div class="empty-state">尚未配置快捷指令</div>';
    updateMetrics();
}

function renderProviders() {
    const html = state.providers.map((p, i) => renderProviderCard(p, i, false)).join("");
    byId("providers-container").innerHTML = html || '<div class="empty-state">尚未配置图像节点</div>';
    updateMetrics();
}

function renderVideoProviders() {
    const html = state.video_providers.map((p, i) => renderProviderCard(p, i, true)).join("");
    byId("video-providers-container").innerHTML = html || '<div class="empty-state">尚未配置视频节点</div>';
    updateMetrics();
}

function renderProviderCard(p, i, isVideo) {
    const prefix = isVideo ? "vid" : "prov";
    const delAction = isVideo ? "del-video-provider" : "del-provider";
    const addModelAction = isVideo ? "add-vid-model" : "add-prov-model";
    const delModelAction = isVideo ? "del-vid-model" : "del-prov-model";
    const modelInputId = isVideo ? `new-model-vid-${i}` : `new-model-img-${i}`;
    const modes = isVideo
        ? [
            ["async_task", "异步轮询"],
            ["openai_sync", "同步阻塞"],
            ["openai_chat", "对话伪装"]
        ]
        : [
            ["openai_image", "标准生图"],
            ["openai_chat", "对话透传"],
            ["gemini_official", "Gemini"],
            ["custom_endpoint", "自定义"]
        ];

    const modeChips = modes.map(([value, label]) => {
        const active = isVideo ? (p.api_type || "").includes(value) : p.api_type === value;
        return `<button type="button" class="api-chip ${active ? "active" : ""}" data-sync="${prefix}-api" data-index="${i}" data-val="${value}">${label}</button>`;
    }).join("");

    const modelChips = (p.available_models || []).map((model, modelIdx) => `
        <button type="button" class="api-chip ${p.model === model ? "active" : ""}" data-sync="${prefix}-model-select" data-index="${i}" data-val="${escapeHtml(model)}">
            <span>${escapeHtml(model)}</span>
            <span class="chip-del" data-action="${delModelAction}" data-index="${i}" data-midx="${modelIdx}">×</span>
        </button>
    `).join("") || '<span class="empty-hint">暂无模型</span>';
    const resolutionMode = p.image_resolution_mode === "custom" ? "custom" : "official";
    const resolutionModeChips = `
        <button type="button" class="api-chip ${resolutionMode === "official" ? "active" : ""}" data-sync="prov-res-mode" data-index="${i}" data-val="official">官方比例+K</button>
        <button type="button" class="api-chip ${resolutionMode === "custom" ? "active" : ""}" data-sync="prov-res-mode" data-index="${i}" data-val="custom">自定义像素</button>
    `;
    const sizeLabel = resolutionMode === "custom" ? "自定义分辨率" : "官方尺寸格式";
    const sizePlaceholder = resolutionMode === "custom" ? "1024x1536 / 2048x2048" : "9:16 4K / 16:9 2K / 2Kx2K";
    const sizeHint = resolutionMode === "custom"
        ? "原样作为 size 发送；Gemini 官方会换算成官方 imageConfig。"
        : "支持 9:16 4K、4K 9:16、2Kx2K 这类格式。";
    const imageOptionFields = isVideo ? "" : `
                <div class="form-group">
                    <label>尺寸格式模式</label>
                    <div class="chip-group">${resolutionModeChips}</div>
                </div>
                <div class="form-group">
                    <label>${sizeLabel}</label>
                    <input type="text" class="input-glass" value="${escapeHtml(p.image_size || "")}" data-sync="prov-size" data-index="${i}" placeholder="${sizePlaceholder}">
                    <small>${sizeHint}</small>
                </div>
                <div class="form-group">
                    <label>单独宽高比（可选）</label>
                    <input type="text" class="input-glass" value="${escapeHtml(p.aspect_ratio || "")}" data-sync="prov-ratio" data-index="${i}" placeholder="1:1 / 16:9 / 9:16">
                    <small>填写后会覆盖上面尺寸里的比例，配置优先。</small>
                </div>
    `;

    return `
        <div class="node-card">
            <div class="node-card-header">
                <input type="text" class="input-glass node-id-input" placeholder="${isVideo ? "视频节点 ID" : "图像节点 ID"}" value="${escapeHtml(p.id)}" data-sync="${prefix}-id" data-index="${i}">
                <button data-action="${delAction}" data-index="${i}" class="btn-ghost btn-danger" type="button">移除节点</button>
            </div>
            <div class="node-form-grid">
                <div class="form-group">
                    <label>${isVideo ? "调用协议" : "接口模式"}</label>
                    <div class="chip-group">${modeChips}</div>
                </div>
                <div class="form-group">
                    <label>接口地址</label>
                    <input type="text" class="input-glass" value="${escapeHtml(p.base_url)}" data-sync="${prefix}-url" data-index="${i}">
                </div>
                <div class="form-group full-width">
                    <label>${isVideo ? "视频模型池" : "算力模型池"}</label>
                    <div class="chip-group">${modelChips}</div>
                    <div class="model-row">
                        <input type="text" class="input-glass" id="${modelInputId}" data-model-input="${isVideo ? "video" : "image"}" data-index="${i}" placeholder="${isVideo ? "输入视频模型名称" : "输入新模型名称"}">
                        <button data-action="${addModelAction}" data-index="${i}" class="btn-glass-secondary" type="button">添加模型</button>
                    </div>
                </div>
                ${imageOptionFields}
                <div class="form-group">
                    <label>请求超时</label>
                    <input type="number" class="input-glass" value="${escapeHtml(p.timeout)}" min="1" data-sync="${prefix}-time" data-index="${i}">
                </div>
                <div class="form-group full-width">
                    <label>API Keys</label>
                    <textarea class="input-glass" rows="3" data-sync="${prefix}-keys" data-index="${i}">${escapeHtml(p.api_keys)}</textarea>
                </div>
            </div>
        </div>
    `;
}

function bindBasicFields() {
    byId("perm_usable_users").value = state.permission_config.usable_users || "";
    byId("perm_allowed_users").value = state.permission_config.allowed_users || "";
    byId("perm_blocked_users").value = state.permission_config.blocked_users || "";
    byId("perm_unlimited_groups").value = state.permission_config.unlimited_groups || "";
    byId("usage_enable").checked = Boolean(state.usage_config.enable_daily_limit);
    byId("usage_daily_limit").value = state.usage_config.daily_image_limit || 20;
    byId("usage_checkin_enable").checked = Boolean(state.usage_config.enable_checkin);
    byId("usage_checkin_min").value = state.usage_config.checkin_bonus_min ?? 1;
    byId("usage_checkin_max").value = state.usage_config.checkin_bonus_max ?? 3;
    byId("cache_scheduled_enable").checked = Boolean(state.cache_config.enable_scheduled_cleanup);
    byId("cache_scheduled_hours").value = state.cache_config.scheduled_cleanup_interval_hours || defaultCacheConfig.scheduled_cleanup_interval_hours;
    byId("cache_limit_enable").checked = Boolean(state.cache_config.enable_size_limit_cleanup);
    byId("cache_max_mb").value = state.cache_config.max_cache_size_mb || defaultCacheConfig.max_cache_size_mb;
    byId("reply_draw_pending").value = state.reply_config.draw_pending_message || defaultReplyConfig.draw_pending_message;
    byId("reply_selfie_pending").value = state.reply_config.selfie_pending_message || defaultReplyConfig.selfie_pending_message;
    byId("reply_draw_error").value = state.reply_config.draw_error_message || defaultReplyConfig.draw_error_message;
    byId("reply_selfie_error").value = state.reply_config.selfie_error_message || defaultReplyConfig.selfie_error_message;
    byId("route_img").value = routePrimary("text2img") || "node_1";
    byId("route_selfie").value = routePrimary("selfie") || "node_1";
    byId("route_video").value = routePrimary("video") || "video_node_1";
    bindPersonaFields();
    byId("opt_enable").checked = Boolean(state.optimizer_config.enable_optimizer);
    byId("opt_style").value = state.optimizer_config.optimizer_style || "手机日常原生感";
    byId("opt_chain").value = state.optimizer_config.chain_optimizer || "node_1";
    byId("opt_model").value = state.optimizer_config.optimizer_model || "gpt-4o-mini";
    byId("opt_timeout").value = state.optimizer_config.optimizer_timeout || 15;
    byId("opt_batch").value = state.optimizer_config.max_batch_count || 0;
    byId("opt_custom").value = state.optimizer_config.optimizer_custom_prompt || "";
    byId("verbose_report").checked = Boolean(state.verbose_report);
    byId("hide_preset_prompt").checked = state.hide_preset_prompt !== false;
    byId("show_generation_time").checked = Boolean(state.show_generation_time);
    byId("show_request_model").checked = Boolean(state.show_request_model);
}

function readBasicFields() {
    state.permission_config.usable_users = normalizeIdText(byId("perm_usable_users").value);
    state.permission_config.allowed_users = normalizeIdText(byId("perm_allowed_users").value);
    state.permission_config.blocked_users = normalizeIdText(byId("perm_blocked_users").value);
    state.permission_config.unlimited_groups = normalizeIdText(byId("perm_unlimited_groups").value);
    state.usage_config.enable_daily_limit = byId("usage_enable").checked;
    state.usage_config.daily_image_limit = Math.max(1, parseInt(byId("usage_daily_limit").value, 10) || 20);
    state.usage_config.enable_checkin = byId("usage_checkin_enable").checked;
    state.usage_config.checkin_bonus_min = readNonnegativeIntInput("usage_checkin_min", 0);
    state.usage_config.checkin_bonus_max = readNonnegativeIntInput("usage_checkin_max", 0);
    if (state.usage_config.checkin_bonus_max < state.usage_config.checkin_bonus_min) {
        state.usage_config.checkin_bonus_max = state.usage_config.checkin_bonus_min;
    }
    state.cache_config.enable_scheduled_cleanup = byId("cache_scheduled_enable").checked;
    state.cache_config.scheduled_cleanup_interval_hours = Math.max(1, parseInt(byId("cache_scheduled_hours").value, 10) || defaultCacheConfig.scheduled_cleanup_interval_hours);
    state.cache_config.enable_size_limit_cleanup = byId("cache_limit_enable").checked;
    state.cache_config.max_cache_size_mb = Math.max(1, parseInt(byId("cache_max_mb").value, 10) || defaultCacheConfig.max_cache_size_mb);
    state.reply_config.draw_pending_message = byId("reply_draw_pending").value.trim() || defaultReplyConfig.draw_pending_message;
    state.reply_config.selfie_pending_message = byId("reply_selfie_pending").value.trim() || defaultReplyConfig.selfie_pending_message;
    state.reply_config.draw_error_message = byId("reply_draw_error").value.trim() || defaultReplyConfig.draw_error_message;
    state.reply_config.selfie_error_message = byId("reply_selfie_error").value.trim() || defaultReplyConfig.selfie_error_message;
    syncRouteFromHidden("text2img");
    syncRouteFromHidden("selfie");
    syncRouteFromHidden("video");
    writeActivePersonaFieldsFromForm();
    state.optimizer_config.enable_optimizer = byId("opt_enable").checked;
    state.optimizer_config.optimizer_style = byId("opt_style").value;
    state.optimizer_config.chain_optimizer = byId("opt_chain").value.trim();
    state.optimizer_config.optimizer_model = byId("opt_model").value.trim();
    state.optimizer_config.optimizer_timeout = parseFloat(byId("opt_timeout").value) || 15;
    state.optimizer_config.max_batch_count = parseInt(byId("opt_batch").value, 10) || 0;
    state.optimizer_config.optimizer_custom_prompt = byId("opt_custom").value;
    state.verbose_report = byId("verbose_report").checked;
    state.hide_preset_prompt = byId("hide_preset_prompt").checked;
    state.show_generation_time = byId("show_generation_time").checked;
    state.show_request_model = byId("show_request_model").checked;
}

function buildPayload() {
    readBasicFields();
    // 同步时段参考图数据到 profiles
    const personaProfiles = (state.persona_config.profiles || []).map((profile) => ({
        id: profile.id,
        persona_name: profile.persona_name,
        persona_base_prompt: profile.persona_base_prompt || "",
        persona_ref_image: profile.persona_ref_image || [],
        time_period_refs: normalizeTimePeriodRefs(profile.time_period_refs)
    }));
    return {
        permission_config: state.permission_config,
        usage_config: state.usage_config,
        cache_config: state.cache_config,
        reply_config: state.reply_config,
        persona_config: {
            active_persona_id: state.persona_config.active_persona_id,
            active_time_period: normalizePeriodKey(state.persona_config.active_time_period || state.persona_period, "day"),
            time_period_hours: state.time_period_hours || { morning: { start: 6, end: 9 }, day: { start: 9, end: 18 }, evening: { start: 18, end: 6 } },
            profiles: personaProfiles,
            persona_name: state.persona_config.persona_name,
            persona_base_prompt: state.persona_config.persona_base_prompt,
            persona_ref_image: state.persona_config.persona_ref_image
        },
        optimizer_config: state.optimizer_config,
        router_config: state.router_config,
        presets: state.presets.filter((p) => p.name.trim()).map((p) => (p.hidden ? `#${p.name.trim()}:${p.prompt || ""}` : `${p.name.trim()}:${p.prompt || ""}`)),
        providers: state.providers,
        video_providers: state.video_providers,
        verbose_report: state.verbose_report,
        hide_preset_prompt: state.hide_preset_prompt,
        show_generation_time: state.show_generation_time,
        show_request_model: state.show_request_model
    };
}

function isCompleteCustomEndpoint(value) {
    try {
        const url = new URL(String(value || "").trim());
        if (!["http:", "https:"].includes(url.protocol)) return false;
        const segments = url.pathname.split("/").filter(Boolean);
        if (!segments.length) return false;
        const last = segments[segments.length - 1] || "";
        if (/^v\d+(beta\d*)?$/i.test(last) || last.toLowerCase() === "api") return false;
        return true;
    } catch {
        return false;
    }
}

function validateConfig() {
    const checkinMin = readNonnegativeIntInput("usage_checkin_min", 0);
    const checkinMax = readNonnegativeIntInput("usage_checkin_max", 0);
    if (byId("usage_checkin_enable").checked && checkinMax < checkinMin) return "签到奖励最大张数不能小于最小张数";
    if (byId("cache_scheduled_enable").checked && readNonnegativeIntInput("cache_scheduled_hours", 0) <= 0) return "定时清理间隔必须大于 0";
    if (byId("cache_limit_enable").checked && readNonnegativeIntInput("cache_max_mb", 0) <= 0) return "缓存容量上限必须大于 0";

    readBasicFields();
    const validateList = (list, label) => {
        const ids = list.map((node) => String(node.id || "").trim()).filter(Boolean);
        const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
        if (list.some((node) => !String(node.id || "").trim())) return `${label}存在未填写节点 ID`;
        if (duplicates.length) return `${label}节点 ID 重复：${duplicates[0]}`;
        const invalidCustom = list.find((node) => node.api_type === "custom_endpoint" && !isCompleteCustomEndpoint(node.base_url));
        if (invalidCustom) return `${label}自定义节点 ${invalidCustom.id || ""} 必须填写完整 http(s) 请求路径，不能只填域名或 /v1`;
        return "";
    };
    const validateRoute = (routeName, label) => {
        const def = routeDefs[routeName];
        const ids = new Set(def.source().map((node) => String(node.id || "").trim()).filter(Boolean));
        if (!ids.size) return "";
        const missing = routeChain(routeName).find((nodeId) => !ids.has(nodeId));
        return missing ? `${label}链路包含不存在的节点：${missing}` : "";
    };
    writeActivePersonaFieldsFromForm();
    const personaIds = state.persona_config.profiles.map((profile) => String(profile.id || "").trim()).filter(Boolean);
    const personaNames = state.persona_config.profiles.map((profile) => String(profile.persona_name || "").trim());
    const duplicatePersonaIds = personaIds.filter((id, idx) => personaIds.indexOf(id) !== idx);
    if (!state.persona_config.profiles.length) return "至少需要保留一个人设";
    if (personaNames.some((name) => !name)) return "人设名称不能为空";
    if (duplicatePersonaIds.length) return `人设 ID 重复：${duplicatePersonaIds[0]}`;
    if (state.usage_config.enable_daily_limit && state.usage_config.daily_image_limit <= 0) return "每日生图上限必须大于 0";
    return validateList(state.providers, "图像")
        || validateList(state.video_providers, "视频")
        || validateRoute("text2img", "图像生成")
        || validateRoute("selfie", "人设自拍")
        || validateRoute("video", "视频渲染");
}

function setActiveTab(navItem) {
    const targetId = navItem.getAttribute("data-target");
    const targetPane = byId(targetId);
    if (!targetPane) return;
    const content = document.querySelector(".content");
    content?.classList.add("is-switching");
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === navItem));
    document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane === targetPane));
    if (targetId === "tab-current-refs") renderCurrentReferenceView();
    byId("active-title").textContent = targetPane.dataset.title || navItem.textContent.trim();
    navItem.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    window.setTimeout(() => content?.classList.remove("is-switching"), 260);
}

function animateAdd(containerId) {
    setTimeout(() => {
        const container = byId(containerId);
        const el = container?.lastElementChild;
        if (!el) return;
        el.classList.add("node-enter");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 10);
}

function animateDel(containerId, stateArray, index, renderFn, callback) {
    const container = byId(containerId);
    const el = container?.children[index];
    if (!el) {
        stateArray.splice(index, 1);
        renderFn();
        callback?.();
        setDirty();
        return;
    }
    el.classList.add("node-exit");
    setTimeout(() => {
        stateArray.splice(index, 1);
        renderFn();
        callback?.();
        setDirty();
    }, 220);
}

function addModel(kind, idx) {
    const isVideo = kind === "video";
    const list = isVideo ? state.video_providers : state.providers;
    const input = byId(isVideo ? `new-model-vid-${idx}` : `new-model-img-${idx}`);
    const newModel = input?.value.trim();
    if (!newModel) return;
    if (list[idx].available_models.includes(newModel)) {
        showToast("模型已存在", "error");
        return;
    }
    list[idx].available_models.push(newModel);
    if (!list[idx].model) list[idx].model = newModel;
    input.value = "";
    isVideo ? renderVideoProviders() : renderProviders();
    setDirty();
}

function switchPersona(index) {
    const profiles = state.persona_config.profiles || [];
    if (!profiles[index]) return;
    writeActivePersonaFieldsFromForm();
    state.persona_config.active_persona_id = profiles[index].id;
    state.persona_period = normalizePeriodKey(state.persona_config.active_time_period, "day");
    bindPersonaFields();
    renderPersonaProfiles();
    renderPersonaImages();
    showToast(`已切换至「${profiles[index].persona_name || "未命名人设"}」`);
    setDirty();
}

function addPersona() {
    writeActivePersonaFieldsFromForm();
    const usedIds = new Set((state.persona_config.profiles || []).map((profile) => profile.id));
    const index = state.persona_config.profiles.length;
    const id = uniquePersonaId(`persona_${index + 1}`, index, usedIds);
    const profile = {
        id,
        persona_name: `人设 ${index + 1}`,
        persona_base_prompt: "",
        persona_ref_image: [],
        time_period_refs: { morning: [], day: [], evening: [] }
    };
    state.persona_config.profiles.push(profile);
    state.persona_config.active_persona_id = profile.id;
    bindPersonaFields();
    renderPersonaProfiles();
    renderPersonaImages();
    showToast("已新增人设");
    setDirty();
    byId("persona_name")?.focus();
}

function deletePersona(index) {
    const profiles = state.persona_config.profiles || [];
    if (profiles.length <= 1 || !profiles[index]) {
        showToast("至少需要保留一个人设", "error");
        return;
    }
    const removingActive = profiles[index].id === state.persona_config.active_persona_id;
    const removed = profiles.splice(index, 1)[0];
    if (removingActive) {
        const fallback = profiles[Math.max(0, index - 1)] || profiles[0];
        state.persona_config.active_persona_id = fallback.id;
        bindPersonaFields();
        renderPersonaImages();
    }
    renderPersonaProfiles();
    showToast(`已删除「${removed.persona_name || removed.id}」`);
    setDirty();
}

function setupEventDelegation() {
    const fileInput = byId("hidden-file-input");
    const pressableSelector = ".nav-item, .btn-primary, .btn-secondary, .btn-glass-secondary, .btn-ghost, .upload-trigger, .selector-chip, .api-chip, .persona-profile-chip";

    document.body.addEventListener("pointerdown", (e) => {
        const target = e.target.closest(pressableSelector);
        if (!target || target.disabled) return;
        target.classList.add("is-pressing");
    });

    const clearPressed = () => {
        document.querySelectorAll(".is-pressing").forEach((item) => item.classList.remove("is-pressing"));
    };
    document.addEventListener("focusin", (e) => {
        const input = e.target;
        if (input.hasAttribute("data-sync")) {
            const s = input.getAttribute("data-sync");
            if (["prov-id", "vid-id"].includes(s)) {
                const i = parseInt(input.getAttribute("data-index"), 10);
                const list = s === "prov-id" ? state.providers : state.video_providers;
                state._changing_provider_old_id = list[i]?.id || "";
            }
        }
    });
    document.addEventListener("pointerup", clearPressed);
    document.addEventListener("pointercancel", clearPressed);
    document.addEventListener("pointerleave", clearPressed);
    document.addEventListener("click", clearPressed);

    document.body.addEventListener("click", (e) => {
        const navItem = e.target.closest(".nav-item");
        if (navItem) {
            setActiveTab(navItem);
            return;
        }

        const chip = e.target.closest(".selector-chip");
        if (chip) {
            if (chip.hasAttribute("data-route")) {
                handleRouteChipClick(chip);
                return;
            }
            const inputId = chip.getAttribute("data-input");
            byId(inputId).value = chip.getAttribute("data-id");
            document.querySelectorAll(`.selector-chip[data-input="${inputId}"]`).forEach((item) => item.classList.remove("active"));
            chip.classList.add("active");
            setDirty();
            return;
        }

        const apiChip = e.target.closest(".api-chip");
        if (apiChip && !e.target.closest(".chip-del")) {
            const sync = apiChip.getAttribute("data-sync");
            const idx = parseInt(apiChip.getAttribute("data-index"), 10);
            const val = apiChip.getAttribute("data-val");
            if (sync === "prov-api") {
                state.providers[idx].api_type = val;
                applyImageProviderDefaults(state.providers[idx]);
            }
            if (sync === "vid-api") state.video_providers[idx].api_type = val;
            if (sync === "prov-res-mode") state.providers[idx].image_resolution_mode = val;
            if (sync === "prov-model-select") state.providers[idx].model = val;
            if (sync === "vid-model-select") state.video_providers[idx].model = val;
            sync.startsWith("vid") ? renderVideoProviders() : renderProviders();
            setDirty();
            return;
        }

        if (e.target.closest("#persona-upload-trigger")) {
            fileInput.click();
            return;
        }

        const periodTab = e.target.closest(".period-tab");
        if (periodTab) {
            const period = periodTab.getAttribute("data-period");
            if (period) switchPersonaPeriod(period);
            return;
        }

        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const act = btn.getAttribute("data-action");
        const idx = parseInt(btn.getAttribute("data-index"), 10);

        if (act === "save-config") saveConfig(btn);
        if (act === "refresh-usage") {
            loadUsageStats(true);
            return;
        }
        if (act === "refresh-cache") {
            loadCacheStats(true);
            return;
        }
        if (act === "clear-cache") {
            clearCache(btn);
            return;
        }
        if (act === "switch-persona") {
            switchPersona(idx);
            return;
        }
        if (act === "add-persona") {
            addPersona();
            return;
        }
        if (act === "del-persona") {
            deletePersona(idx);
            return;
        }
        if (act === "add-preset") {
            state.presets.push({ name: "", prompt: "" });
            renderPresets();
            animateAdd("presets-container");
            setDirty();
        }
        if (act === "del-preset") animateDel("presets-container", state.presets, idx, renderPresets);
        if (act === "add-provider") {
            state.providers.push({ id: `node_${state.providers.length + 1}`, api_type: "openai_image", base_url: "", model: "", available_models: [], image_resolution_mode: "official", image_size: "", aspect_ratio: "", api_keys: "", timeout: 60 });
            renderProviders();
            renderSelectors();
            animateAdd("providers-container");
            setDirty();
        }
        if (act === "del-provider") animateDel("providers-container", state.providers, idx, renderProviders, renderSelectors);
        if (act === "add-video-provider") {
            state.video_providers.push({ id: `video_node_${state.video_providers.length + 1}`, api_type: "async_task", base_url: "", model: "", available_models: [], api_keys: "", timeout: 300 });
            renderVideoProviders();
            renderSelectors();
            animateAdd("video-providers-container");
            setDirty();
        }
        if (act === "del-video-provider") animateDel("video-providers-container", state.video_providers, idx, renderVideoProviders, renderSelectors);
        if (act === "del-persona-img") {
            const period = state.persona_period || "day";
            const activePersona = getActivePersona();
            activePersona.time_period_refs = activePersona.time_period_refs || { morning: [], day: [], evening: [] };
            activePersona.time_period_refs[period] = activePersona.time_period_refs[period] || [];
            // 若当前时段有专用图则删除时段图，否则删除共享图
            const targetArray = activePersona.time_period_refs[period].length
                ? activePersona.time_period_refs[period]
                : (activePersona.persona_ref_image || []);
            animateDel("persona-upload-container", targetArray, idx, () => {
                syncActivePersonaMirror();
                renderPersonaImages();
                renderPersonaProfiles();
            });
        }
        if (act === "add-prov-model") addModel("image", idx);
        if (act === "add-vid-model") addModel("video", idx);
        if (act === "del-prov-model") {
            const modelIdx = parseInt(btn.getAttribute("data-midx"), 10);
            const removed = state.providers[idx].available_models.splice(modelIdx, 1)[0];
            if (state.providers[idx].model === removed) state.providers[idx].model = state.providers[idx].available_models[0] || "";
            renderProviders();
            setDirty();
        }
        if (act === "del-vid-model") {
            const modelIdx = parseInt(btn.getAttribute("data-midx"), 10);
            const removed = state.video_providers[idx].available_models.splice(modelIdx, 1)[0];
            if (state.video_providers[idx].model === removed) state.video_providers[idx].model = state.video_providers[idx].available_models[0] || "";
            renderVideoProviders();
            setDirty();
        }
    });

    document.body.addEventListener("input", (e) => {
        const input = e.target;
        // 时段小时输入
        if (input.hasAttribute("data-period-hour")) {
            const field = input.getAttribute("data-period-hour");
            const period = state.persona_period || "day";
            const val = Math.max(0, Math.min(23, parseInt(input.value, 10) || 0));
            state.time_period_hours[period] = state.time_period_hours[period] || { start: 6, end: 9 };
            state.time_period_hours[period][field] = val;
            setDirty();
            return;
        }
        if (!input.hasAttribute("data-sync")) {
            if (["INPUT", "TEXTAREA", "SELECT"].includes(input.tagName)) setDirty();
            return;
        }
        const s = input.getAttribute("data-sync");
        const i = parseInt(input.getAttribute("data-index"), 10);
        const v = input.value;
        if (s === "preset-name") state.presets[i].name = v;
        if (s === "preset-prompt") state.presets[i].prompt = v;
        if (s === "persona-name") {
            getActivePersona().persona_name = v.trim() || "未命名人设";
            syncActivePersonaMirror();
            renderPersonaProfiles();
            renderCurrentReferenceView();
        }
        if (s === "persona-prompt") {
            getActivePersona().persona_base_prompt = v;
            syncActivePersonaMirror();
        }
        if (s === "prov-id") state.providers[i].id = v;
        if (s === "prov-url") state.providers[i].base_url = v;
        if (s === "prov-size") state.providers[i].image_size = v.trim();
        if (s === "prov-ratio") state.providers[i].aspect_ratio = v.trim();
        if (s === "prov-time") state.providers[i].timeout = parseFloat(v) || 60;
        if (s === "prov-keys") state.providers[i].api_keys = v;
        if (s === "vid-id") state.video_providers[i].id = v;
        if (s === "vid-url") state.video_providers[i].base_url = v;
        if (s === "vid-time") state.video_providers[i].timeout = parseFloat(v) || 300;
        if (s === "vid-keys") state.video_providers[i].api_keys = v;
        setDirty();
    });

    document.body.addEventListener("change", (e) => {
        const input = e.target;
        if (input.classList.contains("route-backup-toggle")) {
            setRouteBackupEnabled(input.getAttribute("data-route"), input.checked);
            setDirty();
            return;
        }
        if (input.hasAttribute("data-sync")) {
            const s = input.getAttribute("data-sync");
            const i = parseInt(input.getAttribute("data-index"), 10);
            if (s === "preset-hidden") {
                state.presets[i].hidden = input.checked;
            }
            if (["prov-id", "vid-id"].includes(s)) {
                // 节点 ID 变更时，同步更新所有链路中的旧 ID
                const list = s === "prov-id" ? state.providers : state.video_providers;
                const newId = list[i]?.id || "";
                Object.keys(routeDefs).forEach((routeName) => {
                    const chain = splitChain(state.router_config[routeDefs[routeName].stateKey]);
                    let changed = false;
                    const updated = chain.map((nodeId) => {
                        if (nodeId === state._changing_provider_old_id) {
                            changed = true;
                            return newId;
                        }
                        return nodeId;
                    });
                    if (changed) {
                        writeRouteChain(routeName, updated);
                    }
                });
                state._changing_provider_old_id = null;
                renderSelectors();
            }
        }
        setDirty();
    });

    document.body.addEventListener("keydown", (e) => {
        const input = e.target.closest("[data-model-input]");
        if (!input || e.key !== "Enter") return;
        e.preventDefault();
        addModel(input.getAttribute("data-model-input"), parseInt(input.getAttribute("data-index"), 10));
    });

    fileInput.addEventListener("change", (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        let loadedCount = 0;
        const activePersona = getActivePersona();
        const period = state.persona_period || "day";
        activePersona.time_period_refs = activePersona.time_period_refs || { morning: [], day: [], evening: [] };
        activePersona.time_period_refs[period] = activePersona.time_period_refs[period] || [];
        files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (evt) => {
                activePersona.time_period_refs[period].push(evt.target.result);
                loadedCount += 1;
                if (loadedCount === files.length) {
                    syncActivePersonaMirror();
                    renderPersonaImages();
                    renderPersonaProfiles();
                    showToast(`已添加 ${files.length} 张图片到${{"morning":"早上","day":"白天","evening":"晚上"}[period]}`);
                    setDirty();
                }
            };
            reader.readAsDataURL(file);
        });
        fileInput.value = "";
    });
}

async function saveConfig(btn) {
    const validationError = validateConfig();
    if (validationError) {
        showToast(validationError, "error");
        return;
    }
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "保存中...";
    try {
        const payload = buildPayload();
        const res = await bridge.apiPost("save_config", payload);
        if (res?.success) {
            savedSnapshot = JSON.stringify(payload);
            setDirty(false);
            renderUsageStats();
            showToast("配置已保存");
        } else {
            showToast(res?.message || "保存失败", "error");
        }
    } catch (error) {
        console.error(error);
        showToast("网络错误", "error");
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 420);
    }
}

async function init() {
    await bridge.ready();
    const rawConfig = await bridge.apiGet("get_config") || {};
    const perm = rawConfig.permission_config || rawConfig;
    const pers = rawConfig.persona_config || rawConfig;
    const opt = rawConfig.optimizer_config || rawConfig;
    const route = rawConfig.router_config || rawConfig;

    state.permission_config = normalizePermissionConfig(perm);
    state.usage_config = normalizeUsageConfig(rawConfig.usage_config || {});
    state.cache_config = normalizeCacheConfig(rawConfig.cache_config || {});
    state.reply_config = normalizeReplyConfig(rawConfig.reply_config || {});
    state.router_config.chain_text2img = joinChain(splitChain(deepFind(route, ["chain_text2img"], "node_1"))) || "node_1";
    state.router_config.chain_selfie = joinChain(splitChain(deepFind(route, ["chain_selfie"], "node_1"))) || "node_1";
    state.router_config.chain_video = joinChain(splitChain(deepFind(route, ["chain_video"], "video_node_1"))) || "video_node_1";
    state.route_backup_enabled = {
        text2img: splitChain(state.router_config.chain_text2img).length > 1,
        selfie: splitChain(state.router_config.chain_selfie).length > 1,
        video: splitChain(state.router_config.chain_video).length > 1
    };
    state.persona_config = normalizePersonaProfiles(pers);
    state.persona_period = normalizePeriodKey(state.persona_config.active_time_period, "day");
    // 加载时段范围配置
    if (pers.time_period_hours && typeof pers.time_period_hours === "object") {
        state.time_period_hours = {
            morning: pers.time_period_hours.morning || { start: 6, end: 9 },
            day: pers.time_period_hours.day || { start: 9, end: 18 },
            evening: pers.time_period_hours.evening || { start: 18, end: 6 }
        };
    }

    state.optimizer_config.enable_optimizer = deepFind(opt, ["enable_optimizer"], true);
    state.optimizer_config.optimizer_style = deepFind(opt, ["optimizer_style"], "手机日常原生感");
    state.optimizer_config.chain_optimizer = deepFind(opt, ["chain_optimizer"], "node_1");
    state.optimizer_config.optimizer_model = deepFind(opt, ["optimizer_model"], "gpt-4o-mini");
    state.optimizer_config.optimizer_timeout = parseFloat(deepFind(opt, ["optimizer_timeout"], 15)) || 15;
    state.optimizer_config.max_batch_count = parseInt(deepFind(opt, ["max_batch_count"], 0), 10) || 0;
    state.optimizer_config.optimizer_custom_prompt = deepFind(opt, ["optimizer_custom_prompt"]);

    state.presets = (rawConfig.presets || []).map(parsePreset);
    state.providers = (rawConfig.providers || []).map((p) => {
        const availableModels = normalizeModelList(p.available_models?.length ? p.available_models : (p.model || p["模型名称"] || ""));
        const model = p.model && !String(p.model).includes(",") ? p.model : (availableModels[0] || "");
        return applyImageProviderDefaults({
            id: p.id || p["节点ID"] || "",
            api_type: p.api_type || p["接口模式"] || "openai_image",
            base_url: p.base_url || p["接口地址 (需含/v1)"] || "",
            model,
            available_models: availableModels,
            image_resolution_mode: p.image_resolution_mode || p.resolution_mode || p["分辨率模式"] || "official",
            image_size: p.image_size || p.imageSize || p.size || p["默认分辨率"] || "",
            aspect_ratio: p.aspect_ratio || p.aspectRatio || p["默认宽高比"] || p["默认比例"] || "",
            timeout: p.timeout || p["超时时间(秒)"] || 60,
            api_keys: normalizeTextAreaKeys(p.api_keys || p["API密钥"] || "")
        });
    });

    state.video_providers = (rawConfig.video_providers || []).map((p) => {
        const availableModels = normalizeModelList(p.available_models?.length ? p.available_models : (p.model || p["模型名称"] || ""));
        const model = p.model && !String(p.model).includes(",") ? p.model : (availableModels[0] || "");
        return {
            id: p.id || p["节点ID"] || "",
            api_type: p.api_type || p["接口模式"] || "async_task",
            base_url: p.base_url || p["接口地址 (需含/v1或/v2)"] || p["接口地址 (需含/v1)"] || "",
            model,
            available_models: availableModels,
            timeout: p.timeout || p["超时时间(秒)"] || 300,
            api_keys: normalizeTextAreaKeys(p.api_keys || p["API密钥"] || "")
        };
    });

    state.verbose_report = Boolean(rawConfig.verbose_report);
    state.hide_preset_prompt = rawConfig.hide_preset_prompt !== false;
    state.show_generation_time = Boolean(rawConfig.show_generation_time);
    state.show_request_model = Boolean(rawConfig.show_request_model);

    bindBasicFields();
    renderSelectors();
    renderPersonaProfiles();
    renderPresets();
    renderProviders();
    renderVideoProviders();
    renderPersonaImages();
    renderUsageStats();
    renderCacheStats();
    setupEventDelegation();
    await loadUsageStats(false);
    await loadCacheStats(false);
    updateMetrics();
    initialized = true;
    savedSnapshot = JSON.stringify(buildPayload());
    setDirty(false);
}

init().catch((error) => {
    console.error(error);
    showToast("配置页初始化失败", "error");
});
