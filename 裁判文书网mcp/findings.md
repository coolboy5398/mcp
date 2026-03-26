# Findings

## 2026-03-21

### 登录态误判根因
1. [`PageOperator.checkLoginRequired()`](src/browser/operator.ts:126) 直接依赖 [`PAGE_SELECTORS.loginRequired`](src/browser/selectors.ts:49) 与 [`PAGE_SELECTORS.loginButton`](src/browser/selectors.ts:50) 判断当前页是否需要登录。
2. 当前选择器包含过宽的 `[class*="login"]`，容易把普通页面中的隐藏节点或非登录容器识别为登录提示。
3. [`SearchTools.searchDocuments()`](src/tools/search.ts:88) 和 [`DocumentTools.getDocument()`](src/tools/document.ts:72) 已通过 [`AuthManager.acquirePage()`](src/auth/manager.ts:722) 使用页面池执行并发请求。
4. [`AuthManager.isLoggedInOnPage()`](src/auth/manager.ts:292) 仍固定读取主页面 [`this.page`](src/auth/manager.ts:114)，无法反映并发业务页的真实状态。

### 修复方向
1. 让登录态检测接受页面参数，或者在业务页内部自行基于当前页判断。
2. 优先依据当前 URL 的登录页特征判断，再结合明确且可见的登录页元素进行兜底。
3. 缩小登录相关选择器范围，移除过宽的 class 模糊匹配。
