/**
 * 浏览器模块导出
 */

// 浏览器管理器
export {
    BrowserManagerConfig,
    BrowserState,
    BrowserManager,
    createBrowserManager,
    getDefaultBrowserManager,
    resetDefaultBrowserManager,
} from './manager.js';

// 页面操作器
export {
    SearchFilters,
    SearchParams,
    OperatorConfig,
    PageOperator,
    createPageOperator,
} from './operator.js';
