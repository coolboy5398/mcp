/**
 * 认证模块导出
 */

// Session存储
export {
    CookieInfo,
    SessionData,
    SessionStoreConfig,
    SessionStore,
    createSessionStore,
    convertPlaywrightCookies,
    convertToPlaywrightCookies,
} from './session-store.js';

// 日志工具
export {
    AuthLogger,
    createAuthLogger,
} from './logger.js';

// 页面池管理
export {
    PagePoolStats,
    PagePoolManager,
    createPagePoolManager,
} from './page-pool.js';

// 认证管理器
export {
    AuthStatus,
    QRCodeInfo,
    WaitLoginResult,
    AuthManagerConfig,
    AuthManager,
    createAuthManager,
    getDefaultAuthManager,
    resetDefaultAuthManager,
} from './manager.js';

