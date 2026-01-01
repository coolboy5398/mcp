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
