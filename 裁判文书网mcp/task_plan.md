# 任务计划

## 目标
修复并发页面场景下的登录态误判问题，确保搜索页与详情页基于“当前业务页”判断是否需要登录，并收敛过宽的登录相关选择器。

## 阶段

### 1. 分析
- [x] 审查未提交变更并定位问题
- [x] 确认问题集中在 [`AuthManager.isLoggedInOnPage()`](src/auth/manager.ts:292) 与 [`PageOperator.checkLoginRequired()`](src/browser/operator.ts:126)

### 2. 设计修复
- [ ] 让登录态判断与具体页面实例绑定
- [ ] 缩小登录页选择器范围，避免误判隐藏或非登录容器

### 3. 实施修复
- [ ] 修改 [`src/auth/manager.ts`](src/auth/manager.ts)
- [ ] 修改 [`src/browser/selectors.ts`](src/browser/selectors.ts)
- [ ] 修改 [`src/browser/operator.ts`](src/browser/operator.ts)

### 4. 回归检查
- [ ] 复查调用链与错误处理路径
- [ ] 确认未引入新的并发回归

## 已知风险
- 登录页 DOM 结构可能变化，需要尽量依赖 URL 与可见容器联合判断。
- 页面池复用旧页面时，必须按当前页面状态判断，不能依赖主页面状态。
