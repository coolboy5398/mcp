/**
 * 页面操作器选择器定义
 */

/**
 * 页面操作器默认配置
 */
export const DEFAULT_OPERATOR_CONFIG = {
    baseUrl: 'https://wenshu.court.gov.cn',
    searchUrl: 'https://wenshu.court.gov.cn/website/wenshu/181029CR4M5A62CH/index.html',
    loadTimeout: 30000,
    elementTimeout: 10000,
} as const;

/**
 * 页面选择器常量
 */
export const PAGE_SELECTORS = {
    searchInputPlaceholder: '输入案由、关键词、法院、当事人、律师',
    searchButtonText: '搜索',
    searchInputFallback: 'input[placeholder*="案由"], input[placeholder*="关键词"]',
    searchInputGeneric: '#suggestSource, input#searchInput',
    searchButtonFallback: 'div:text-is("搜索"), div.search-btn, .search-button',

    resultList: '.LM_list',
    resultTitle: 'h4 a.caseName',
    resultCourt: '.slfyName',
    resultCaseNo: '.ah',
    resultDate: '.cprq',
    resultType: '.labelTwo',
    resultDocIdInput: 'input.ListSelect',

    pagination: '.pagination, .page-nav',
    pageNumber: 'a[href="javascript:;"]',
    nextPage: 'a:has-text("下一页")',
    prevPage: 'a:has-text("上一页")',
    totalCount: ':text("共检索到")',

    documentContent: '.PDF_box, #contentText, .content, .ws-content, .document-content, #content',
    documentTitle: '.PDF_title, .title, h1, .ws-title',
    documentCaseNo: 'span.ah, .case-no, .ah, .caseNo',
    documentCourt: 'span.fy, .slfyName, .court, .fy, .courtName',
    documentDate: 'span.cprq, .date, .cprq, .judgeDate',
    documentParties: '.parties, .dsr, .party-info, .litigant',
    documentJudges: '.judges, .spry, .judge-info',
    documentCause: 'span.ay, .cause, .ay, .case-cause',
    documentFullText: '.PDF_content, #contentText, .full-text, .ws-text, .document-body',

    loginContainer: 'iframe#contentIframe, .login-box, .login-content, .login-panel, .login-container, .login-dialog, .qrcode-container, .login-qrcode',
    loginQRCode: '#alipay-qrcode, .qrcode-container, .login-qrcode, img[src*="alipay.com"], img[id*="qrcode"]',
    loginButton: '.login-btn, button.login-btn, a.login-btn, button:has-text("登录"), a:has-text("登录"), button:has-text("扫码登录"), a:has-text("扫码登录")',
    loginUserInfo: '.user-info, .username, [class*="user-name"], .login-user',
    loginAlipayEntry: '.login-type-item.alipay, .alipay-icon, .alipay-login, img[alt*="支付宝"], [title*="支付宝"], :text("支付宝登录")',
} as const;
