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

// 选择器与配置
export {
    DEFAULT_OPERATOR_CONFIG,
    PAGE_SELECTORS,
} from './selectors.js';

// 页面解析器
export {
    parseSearchResults,
    parseDocumentDetail,
} from './parsers.js';

// 页面操作器
export {
    SearchFilters,
    SearchParams,
    OperatorConfig,
    PageOperator,
    createPageOperator,
} from './operator.js';

